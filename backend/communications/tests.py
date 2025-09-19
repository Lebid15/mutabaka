from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone
from finance.models import Currency, Wallet
from .models import Conversation, Transaction, Message

User = get_user_model()

class TransactionFlowTests(TestCase):
    def setUp(self):
        self.user1 = User.objects.create_user(username='u1', password='pass12345')
        self.user2 = User.objects.create_user(username='u2', password='pass12345')
        # Ensure currencies exist
        self.currency = Currency.objects.create(code='TST', symbol='₮', name='اختبار', precision=2)
        # Create wallets manually (signals in real runtime would do it)
        Wallet.objects.create(user=self.user1, currency=self.currency, balance=0)
        Wallet.objects.create(user=self.user2, currency=self.currency, balance=0)
        self.conv = Conversation.objects.create(user_a=self.user1, user_b=self.user2)

    def test_transaction_creates_message_and_updates_balances(self):
        txn = Transaction.create_transaction(
            conversation=self.conv,
            actor=self.user1,
            currency=self.currency,
            amount=10,
            direction='lna',
            note='test'
        )
        # balances
        w1 = Wallet.objects.get(user=self.user1, currency=self.currency)
        w2 = Wallet.objects.get(user=self.user2, currency=self.currency)
        self.assertEqual(w1.balance, 10)
        self.assertEqual(w2.balance, -10)
        # message created
        msg = Message.objects.filter(conversation=self.conv, type='transaction').first()
        self.assertIsNotNone(msg)
        self.assertIn('معاملة', msg.body)
        # conversation meta updated
        self.conv.refresh_from_db()
        self.assertIsNotNone(self.conv.last_message_at)
        self.assertIsNotNone(self.conv.last_activity_at)
        self.assertTrue(self.conv.last_message_preview.startswith('معاملة'))

    def test_multiple_transactions_adjust_consistently(self):
        Transaction.create_transaction(self.conv, self.user1, self.currency, 5, 'lna')
        Transaction.create_transaction(self.conv, self.user2, self.currency, 2, 'lna')  # user2 receives
        w1 = Wallet.objects.get(user=self.user1, currency=self.currency)
        w2 = Wallet.objects.get(user=self.user2, currency=self.currency)
        # After first: w1=5, w2=-5 ; after second (actor user2 direction=lna): w2= -5 + 2 = -3, w1= 5 -2 = 3
        self.assertEqual(w1.balance, 3)
        self.assertEqual(w2.balance, -3)

    def test_direction_lkm_reduces_actor(self):
        # user1 pays (lkm) 7 => user1 -7, user2 +7
        Transaction.create_transaction(self.conv, self.user1, self.currency, 7, 'lkm')
        w1 = Wallet.objects.get(user=self.user1, currency=self.currency)
        w2 = Wallet.objects.get(user=self.user2, currency=self.currency)
        self.assertEqual(w1.balance, -7)
        self.assertEqual(w2.balance, 7)

    def test_net_balance_endpoint(self):
        # user1 لna 10 ، ثم user2 لkm 4
        # القاعدة الحالية:
        # direction=lna & actor=user_a => +amount
        # direction=lkm & actor=user_b => +amount (يُفسّر كدفع الطرف الآخر لنا)
        # إذن الصافي = 10 + 4 = 14
        Transaction.create_transaction(self.conv, self.user1, self.currency, 10, 'lna')
        Transaction.create_transaction(self.conv, self.user2, self.currency, 4, 'lkm')  # user2 pays us? direction lkm by user2 increases net for user_a
        from django.urls import reverse
        from rest_framework.test import APIClient
        client = APIClient()
        self.assertTrue(client.login(username='u1', password='pass12345'))
        url = reverse('conversations-detail', args=[self.conv.id]) + 'net_balance/'
        resp = client.get(url)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()['net']
        # find our currency entry
        entry = next(e for e in data if e['currency']['code'] == 'TST')
        self.assertEqual(entry['net_from_user_a_perspective'], '14.0')

    def test_amount_rounds_to_5_decimal_places(self):
        # Insert an amount with more than 5 decimals and ensure stored/derived values are rounded half up to 5 dp
        txn = Transaction.create_transaction(
            conversation=self.conv,
            actor=self.user1,
            currency=self.currency,
            amount='12.1234567',  # 7 decimal places
            direction='lna',
            note='rounding check'
        )
        # Amount should be rounded to 12.12346 (numerically)
        from decimal import Decimal
        self.assertEqual(txn.amount, Decimal('12.12346'))
        # Wallet balances should also be rounded to 5 dp and stored (field has 6 dp)
        w1 = Wallet.objects.get(user=self.user1, currency=self.currency)
        w2 = Wallet.objects.get(user=self.user2, currency=self.currency)
        self.assertEqual(w1.balance, Decimal('12.12346'))
        self.assertEqual(w2.balance, Decimal('-12.12346'))


class APIRoundingIntegrationTests(TestCase):
    """End-to-end tests hitting REST endpoints to ensure rounding + summary consistency."""
    def setUp(self):
        self.user1 = User.objects.create_user(username='api_u1', password='pass12345')
        self.user2 = User.objects.create_user(username='api_u2', password='pass12345')
        self.currency = Currency.objects.create(code='APX', symbol='$', name='API Test', precision=2)
        # Create conversation via ORM (could also use endpoint but we test transactions + summary)
        # Ordering: user_a must have lower id
        a, b = (self.user1, self.user2) if self.user1.id < self.user2.id else (self.user2, self.user1)
        self.conv = Conversation.objects.create(user_a=a, user_b=b)

    def api_login(self, client, username, password='pass12345'):
        from django.urls import reverse
        # Using token endpoint would return JWT, but tests rely on session auth for simplicity
        self.assertTrue(client.login(username=username, password=password))

    def test_post_transaction_rounds_and_summary_reflects(self):
        from rest_framework.test import APIClient
        client = APIClient()
        self.api_login(client, 'api_u1')
        # Post transaction with >5 decimals
        resp = client.post('/api/transactions/', {
            'conversation': self.conv.id,
            'currency_id': self.currency.id,
            'amount': '7.3333339',
            'direction': 'lna',
            'note': 'api rounding'
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        # Amount should be rounded to 7.33333 (round half up at 5 dp)
        self.assertEqual(data['amount'], '7.33333')
        # Fetch summary
        sum_resp = client.get(f'/api/conversations/{self.conv.id}/summary/')
        self.assertEqual(sum_resp.status_code, 200)
        sdata = sum_resp.json()['summary']
        entry = next(e for e in sdata if e['currency']['code'] == 'APX')
        # user_a_balance is 7.33333 (actor), user_b_balance is -7.33333 => net = 14.66666
        self.assertEqual(entry['user_a_balance'], '7.33333' if self.conv.user_a_id == self.user1.id else '-7.33333')
        self.assertEqual(entry['user_b_balance'], '-7.33333' if self.conv.user_a_id == self.user1.id else '7.33333')
        self.assertEqual(entry['net_from_user_a_perspective'], '14.66666')

    def test_net_balance_endpoint_after_api_transaction(self):
        from rest_framework.test import APIClient
        client = APIClient()
        self.api_login(client, 'api_u1')
        client.post('/api/transactions/', {
            'conversation': self.conv.id,
            'currency_id': self.currency.id,
            'amount': '3.2000049',  # => 3.20000 (since 3.2000049 rounds down)
            'direction': 'lna'
        }, format='json')
        net_resp = client.get(f'/api/conversations/{self.conv.id}/net_balance/')
        self.assertEqual(net_resp.status_code, 200)
        payload = net_resp.json()['net']
        entry = next(e for e in payload if e['currency']['code'] == 'APX')
        # For net_balance, perspective user_a: only one transaction direction=lna by user_a => +3.2
        self.assertEqual(entry['net_from_user_a_perspective'], '3.2')
