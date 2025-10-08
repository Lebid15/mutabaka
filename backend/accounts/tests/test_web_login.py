from __future__ import annotations

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import UserDevice, WebLoginSession

User = get_user_model()


class WebLoginFlowTests(APITestCase):
    def setUp(self):
        self.password = 'StrongPass123'
        self.user = User.objects.create_user(username='noura', password=self.password)
        self.token_url = reverse('token_obtain_pair')
        self.device_link_url = reverse('device_link')
        self.login_qr_create_url = reverse('login_qr_create')
        self.login_qr_approve_url = reverse('login_qr_approve')
        self.me_url = reverse('auth_me')

    def _login(self, device_id: str | None = None) -> dict:
        headers = {}
        if device_id:
            headers['HTTP_X_DEVICE_ID'] = device_id
        response = self.client.post(
            self.token_url,
            {'username': self.user.username, 'password': self.password},
            format='json',
            **headers,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.json()

    def _auth_headers(self, token: str, device_id: str | None = None) -> dict:
        headers = {'HTTP_AUTHORIZATION': f'Bearer {token}'}
        if device_id:
            headers['HTTP_X_DEVICE_ID'] = device_id
        return headers

    def test_mobile_approves_web_session_and_tokens_consumed_once(self):
        first_login = self._login()
        self.assertTrue(first_login.get('device_registration_required'))
        primary_resp = self.client.post(
            self.device_link_url,
            {'label': 'Galaxy S24', 'platform': 'android'},
            format='json',
            **self._auth_headers(first_login['access']),
        )
        self.assertEqual(primary_resp.status_code, status.HTTP_200_OK)
        primary_device_id = primary_resp.json()['device']['device_id']

        primary_tokens = self._login(primary_device_id)
        self.assertIn('refresh', primary_tokens)

        qr_resp = self.client.get(self.login_qr_create_url)
        self.assertEqual(qr_resp.status_code, status.HTTP_200_OK)
        qr_data = qr_resp.json()
        request_id = qr_data['request_id']
        payload = qr_data['payload']
        self.assertTrue(payload.startswith('mutabaka://'))
        self.assertGreater(qr_data['expires_in'], 0)
        self.assertTrue(
            WebLoginSession.objects.filter(id=request_id, status=WebLoginSession.Status.PENDING).exists()
        )

        status_url = reverse('login_qr_status', kwargs={'request_id': request_id})
        pending_status = self.client.get(status_url)
        self.assertEqual(pending_status.status_code, status.HTTP_200_OK)
        self.assertEqual(pending_status.json()['status'], 'pending')

        approve_resp = self.client.post(
            self.login_qr_approve_url,
            {'payload': payload, 'label': 'Chrome on Windows'},
            format='json',
            **self._auth_headers(primary_tokens['access'], primary_device_id),
        )
        self.assertEqual(approve_resp.status_code, status.HTTP_200_OK)
        approve_data = approve_resp.json()
        new_device_id = approve_data['device_id']
        web_device = UserDevice.objects.get(id=new_device_id)
        self.assertTrue(web_device.is_web)
        self.assertEqual(web_device.status, UserDevice.Status.ACTIVE)

        approved_poll = self.client.get(status_url)
        self.assertEqual(approved_poll.status_code, status.HTTP_200_OK)
        approved_payload = approved_poll.json()
        self.assertEqual(approved_payload['status'], 'approved')
        self.assertIn('access', approved_payload)
        self.assertIn('refresh', approved_payload)
        self.assertEqual(approved_payload['user']['id'], self.user.id)

        me_resp = self.client.get(
            self.me_url,
            **self._auth_headers(approved_payload['access'], new_device_id),
        )
        self.assertEqual(me_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(me_resp.json()['id'], self.user.id)

        consumed_poll = self.client.get(status_url)
        self.assertEqual(consumed_poll.status_code, status.HTTP_410_GONE)
        self.assertEqual(consumed_poll.json()['status'], 'consumed')

    def test_invalid_token_rejected(self):
        first_login = self._login()
        primary = self.client.post(
            self.device_link_url,
            {'label': 'iPhone', 'platform': 'ios'},
            format='json',
            **self._auth_headers(first_login['access']),
        )
        device_id = primary.json()['device']['device_id']
        tokens = self._login(device_id)

        qr_resp = self.client.get(self.login_qr_create_url)
        request_id = qr_resp.json()['request_id']
        status_url = reverse('login_qr_status', kwargs={'request_id': request_id})

        bad_resp = self.client.post(
            self.login_qr_approve_url,
            {'token': 'invalid-token', 'request_id': request_id},
            format='json',
            **self._auth_headers(tokens['access'], device_id),
        )
        self.assertEqual(bad_resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(bad_resp.json()['detail'], 'token_mismatch')

        still_pending = self.client.get(status_url)
        self.assertEqual(still_pending.status_code, status.HTTP_200_OK)
        self.assertEqual(still_pending.json()['status'], 'pending')

    def test_web_device_limit_enforced(self):
        """Test that users cannot approve more than 5 web devices."""
        # Setup: Login with primary mobile device
        first_login = self._login()
        primary = self.client.post(
            self.device_link_url,
            {'label': 'Primary Phone', 'platform': 'android'},
            format='json',
            **self._auth_headers(first_login['access']),
        )
        device_id = primary.json()['device']['device_id']
        tokens = self._login(device_id)
        auth_headers = self._auth_headers(tokens['access'], device_id)

        # Approve 5 web devices (should all succeed)
        for i in range(5):
            qr_resp = self.client.get(self.login_qr_create_url)
            qr_data = qr_resp.json()
            approve_resp = self.client.post(
                self.login_qr_approve_url,
                {'payload': qr_data['payload'], 'label': f'Browser {i+1}'},
                format='json',
                **auth_headers,
            )
            self.assertEqual(approve_resp.status_code, status.HTTP_200_OK, 
                           f"Browser {i+1} should be approved")

        # Verify we have exactly 5 web devices
        web_devices_count = UserDevice.objects.filter(
            user=self.user, 
            is_web=True,
            status__in=[UserDevice.Status.PRIMARY, UserDevice.Status.ACTIVE]
        ).count()
        self.assertEqual(web_devices_count, 5)

        # Try to approve 6th web device (should fail)
        qr_resp = self.client.get(self.login_qr_create_url)
        qr_data = qr_resp.json()
        reject_resp = self.client.post(
            self.login_qr_approve_url,
            {'payload': qr_data['payload'], 'label': 'Browser 6'},
            format='json',
            **auth_headers,
        )
        self.assertEqual(reject_resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(reject_resp.json()['detail'], 'web_device_limit_reached')
        self.assertIn('message', reject_resp.json())
        self.assertEqual(reject_resp.json()['limit'], 5)
        self.assertEqual(reject_resp.json()['current'], 5)

    def test_reuses_existing_browser_when_fingerprint_matches(self):
        first_login = self._login()
        primary_resp = self.client.post(
            self.device_link_url,
            {'label': 'Primary Phone', 'platform': 'android'},
            format='json',
            **self._auth_headers(first_login['access']),
        )
        primary_device_id = primary_resp.json()['device']['device_id']
        tokens = self._login(primary_device_id)
        auth_headers = self._auth_headers(tokens['access'], primary_device_id)

        fingerprint = 'fp-browser-123'
        stored_id = 'stored-browser-123'

        qr_resp = self.client.post(
            self.login_qr_create_url,
            {'device_fingerprint': fingerprint, 'stored_device_id': stored_id},
            format='json',
        )
        self.assertEqual(qr_resp.status_code, status.HTTP_200_OK)
        qr_data = qr_resp.json()

        approve_resp = self.client.post(
            self.login_qr_approve_url,
            {
                'payload': qr_data['payload'],
                'label': 'Chrome Laptop',
                'stored_device_id': stored_id,
                'device_fingerprint': fingerprint,
            },
            format='json',
            **auth_headers,
        )
        self.assertEqual(approve_resp.status_code, status.HTTP_200_OK)
        first_device_id = approve_resp.json()['device_id']
        first_device = UserDevice.objects.get(id=first_device_id)
        self.assertTrue(first_device.is_web)
        self.assertEqual(first_device.device_fingerprint, fingerprint)
        self.assertEqual(first_device.stored_device_id, stored_id)

        # Second login attempt from the same browser
        qr_resp_two = self.client.post(
            self.login_qr_create_url,
            {'device_fingerprint': fingerprint, 'stored_device_id': stored_id},
            format='json',
        )
        self.assertEqual(qr_resp_two.status_code, status.HTTP_200_OK)
        qr_data_two = qr_resp_two.json()

        approve_resp_two = self.client.post(
            self.login_qr_approve_url,
            {
                'payload': qr_data_two['payload'],
                'label': 'Chrome Laptop',
                'stored_device_id': stored_id,
                'device_fingerprint': fingerprint,
            },
            format='json',
            **auth_headers,
        )
        self.assertEqual(approve_resp_two.status_code, status.HTTP_200_OK)
        self.assertEqual(approve_resp_two.json()['device_id'], first_device_id)

        active_web_devices = UserDevice.objects.filter(
            user=self.user,
            is_web=True,
            status__in=[UserDevice.Status.PRIMARY, UserDevice.Status.ACTIVE]
        )
        self.assertEqual(active_web_devices.count(), 1)

    def test_status_endpoint_updates_session_and_reuses_by_stored_id(self):
        first_login = self._login()
        primary_resp = self.client.post(
            self.device_link_url,
            {'label': 'Primary Phone', 'platform': 'android'},
            format='json',
            **self._auth_headers(first_login['access']),
        )
        primary_device_id = primary_resp.json()['device']['device_id']
        tokens = self._login(primary_device_id)
        auth_headers = self._auth_headers(tokens['access'], primary_device_id)

        stored_id = 'stored-device-xyz'
        fingerprint_one = 'fingerprint-one'
        fingerprint_two = 'fingerprint-two'

        # First browser link: create QR via GET then attach identifiers via status POST
        qr_resp = self.client.get(self.login_qr_create_url)
        self.assertEqual(qr_resp.status_code, status.HTTP_200_OK)
        qr_data = qr_resp.json()
        status_url = reverse('login_qr_status', kwargs={'request_id': qr_data['request_id']})

        attach_resp = self.client.post(
            status_url,
            {'device_fingerprint': fingerprint_one, 'stored_device_id': stored_id},
            format='json',
        )
        self.assertEqual(attach_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(attach_resp.json()['detail'], 'updated')

        approve_resp = self.client.post(
            self.login_qr_approve_url,
            {
                'payload': qr_data['payload'],
                'label': 'Office Chrome',
                'stored_device_id': stored_id,
            },
            format='json',
            **auth_headers,
        )
        self.assertEqual(approve_resp.status_code, status.HTTP_200_OK)
        device_id = approve_resp.json()['device_id']
        device = UserDevice.objects.get(id=device_id)
        self.assertEqual(device.device_fingerprint, fingerprint_one)
        self.assertEqual(device.stored_device_id, stored_id)

        # Second login: attach new fingerprint but same stored_id to trigger fallback
        qr_resp_second = self.client.get(self.login_qr_create_url)
        self.assertEqual(qr_resp_second.status_code, status.HTTP_200_OK)
        qr_data_second = qr_resp_second.json()
        status_url_second = reverse('login_qr_status', kwargs={'request_id': qr_data_second['request_id']})

        attach_resp_second = self.client.post(
            status_url_second,
            {'device_fingerprint': fingerprint_two, 'stored_device_id': stored_id},
            format='json',
        )
        self.assertEqual(attach_resp_second.status_code, status.HTTP_200_OK)
        self.assertEqual(attach_resp_second.json()['detail'], 'updated')

        approve_resp_second = self.client.post(
            self.login_qr_approve_url,
            {
                'payload': qr_data_second['payload'],
                'label': 'Office Chrome',
                'stored_device_id': stored_id,
                'device_fingerprint': fingerprint_two,
            },
            format='json',
            **auth_headers,
        )
        self.assertEqual(approve_resp_second.status_code, status.HTTP_200_OK)
        self.assertEqual(approve_resp_second.json()['device_id'], device_id)

        device.refresh_from_db()
        self.assertEqual(device.device_fingerprint, fingerprint_two)
        self.assertEqual(device.stored_device_id, stored_id)

        self.assertEqual(
            UserDevice.objects.filter(
                user=self.user,
                is_web=True,
                status__in=[UserDevice.Status.PRIMARY, UserDevice.Status.ACTIVE],
            ).count(),
            1,
        )
