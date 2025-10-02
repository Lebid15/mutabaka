from __future__ import annotations

from django.urls import reverse
from django.utils import timezone
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import TrustedDevice, UserSecurityAudit


class PinPhaseOneTests(APITestCase):
    def setUp(self):
        super().setUp()
        self.User = get_user_model()
        self.admin = self.User.objects.create_user(
            username='admin',
            email='admin@example.com',
            password='admin-pass',
            is_staff=True,
            is_superuser=True,
        )
        self.member = self.User.objects.create_user(
            username='member',
            email='member@example.com',
            password='member-pass',
        )

    def test_pin_status_reflects_server_flags(self):
        self.member.pin_enabled = True
        self.member.pin_epoch = 3
        self.member.pin_hash = 'dummy-hash'
        self.member.pin_initialized_at = timezone.now() - timezone.timedelta(hours=1)
        self.member.pin_locked_until = timezone.now() + timezone.timedelta(minutes=5)
        self.member.pin_failed_attempts = 2
        self.member.save()

        self.client.force_authenticate(user=self.member)
        response = self.client.get(reverse('pin_status'))
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['pin_enabled'])
        self.assertTrue(payload['pin_set'])
        self.assertEqual(payload['pin_epoch'], 3)
        self.assertGreaterEqual(payload['pin_failed_attempts'], 0)
        self.assertIsNotNone(payload['pin_initialized_at'])
        self.assertIsNotNone(payload['pin_locked_until'])
        self.assertIn('server_time', payload)

    def test_admin_reset_clears_pin_and_creates_audit_entry(self):
        self.member.pin_hash = 'dummy-hash'
        self.member.pin_enabled = True
        self.member.pin_epoch = 9
        self.member.pin_failed_attempts = 4
        self.member.pin_locked_until = timezone.now() + timezone.timedelta(minutes=30)
        self.member.pin_initialized_at = timezone.now() - timezone.timedelta(days=2)
        self.member.save()
        TrustedDevice.objects.create(user=self.member, fingerprint='abc123', device_name='iPhone')

        self.client.force_authenticate(user=self.admin)
        url = reverse('pin_reset')
        response = self.client.post(url, {'user_id': self.member.id, 'reason': 'suspicious device'})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.member.refresh_from_db()

        self.assertEqual(self.member.pin_hash, '')
        self.assertFalse(self.member.pin_enabled)
        self.assertEqual(self.member.pin_failed_attempts, 0)
        self.assertIsNone(self.member.pin_locked_until)
        self.assertIsNone(self.member.pin_initialized_at)
        self.assertEqual(self.member.pin_epoch, 10)
        self.assertEqual(self.member.trusted_devices.count(), 0)

        self.assertEqual(payload['pin_epoch'], 10)
        self.assertFalse(payload['pin_enabled'])
        self.assertGreaterEqual(payload['devices_revoked'], 1)

        audit_entry = UserSecurityAudit.objects.get(subject=self.member)
        self.assertEqual(audit_entry.actor, self.admin)
        self.assertEqual(audit_entry.action, UserSecurityAudit.ACTION_PIN_RESET)
        self.assertEqual(audit_entry.metadata.get('previous_epoch'), 9)
        self.assertEqual(audit_entry.metadata.get('new_epoch'), 10)
        self.assertEqual(audit_entry.metadata.get('reason'), 'suspicious device')

    def test_non_admin_cannot_reset_pin(self):
        self.client.force_authenticate(user=self.member)
        response = self.client.post(reverse('pin_reset'), {'user_id': self.member.id})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(UserSecurityAudit.objects.count(), 0)
