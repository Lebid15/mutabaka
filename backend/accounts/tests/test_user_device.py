from __future__ import annotations

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from accounts.models import UserDevice

User = get_user_model()


class UserDeviceFlowTests(APITestCase):
    def setUp(self):
        self.password = 'StrongPass123'
        self.user = User.objects.create_user(username='alice', password=self.password)
        self.token_url = reverse('token_obtain_pair')
        self.device_link_url = reverse('device_link')
        self.device_list_url = reverse('device_list')
        self.device_approve_url = reverse('device_approve')
        self.device_rename_url = reverse('device_rename')
        self.device_revoke_url = reverse('device_revoke')

    def _login(self, device_id: str | None = None) -> dict:
        headers = {}
        if device_id:
            headers['HTTP_X_DEVICE_ID'] = device_id
        response = self.client.post(self.token_url, {'username': self.user.username, 'password': self.password}, format='json', **headers)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.json()

    def _auth_headers(self, token: str, device_id: str | None = None) -> dict:
        headers = {'HTTP_AUTHORIZATION': f'Bearer {token}'}
        if device_id:
            headers['HTTP_X_DEVICE_ID'] = device_id
        return headers

    def test_first_device_becomes_primary(self):
        login_data = self._login()
        self.assertNotIn('refresh', login_data)
        self.assertTrue(login_data.get('device_registration_required'))
        access = login_data['access']

        response = self.client.post(
            self.device_link_url,
            {'label': 'Alice iPhone', 'platform': 'ios'},
            format='json',
            **self._auth_headers(access),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        device_payload = response.json()['device']
        primary_id = device_payload['device_id']
        self.assertEqual(device_payload['status'], 'primary')

        # Now list devices with the new device id (should pass middleware)
        new_login = self._login(primary_id)
        self.assertIn('refresh', new_login)
        list_resp = self.client.get(self.device_list_url, **self._auth_headers(new_login['access'], primary_id))
        self.assertEqual(list_resp.status_code, status.HTTP_200_OK)
        devices = list_resp.json()['devices']
        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0]['status'], 'primary')

    def test_pending_device_requires_approval(self):
        # Bootstrap primary
        primary_link = self.client.post(
            self.device_link_url,
            {'label': 'Primary Web', 'platform': 'web'},
            format='json',
            **self._auth_headers(self._login()['access']),
        )
        primary_id = primary_link.json()['device']['device_id']

        primary_tokens = self._login(primary_id)
        secondary_login = self._login()
        pending_resp = self.client.post(
            self.device_link_url,
            {'label': 'Tablet', 'platform': 'android'},
            format='json',
            **self._auth_headers(secondary_login['access']),
        )
        self.assertEqual(pending_resp.status_code, status.HTTP_200_OK)
        pending_payload = pending_resp.json()['device']
        self.assertEqual(pending_payload['status'], 'pending')
        self.assertIn('pending_token', pending_payload)
        pending_id = pending_payload['device_id']

        approve_resp = self.client.post(
            self.device_approve_url,
            {'pending_token': pending_payload['pending_token']},
            format='json',
            **self._auth_headers(primary_tokens['access'], primary_id),
        )
        self.assertEqual(approve_resp.status_code, status.HTTP_200_OK)
        approved_payload = approve_resp.json()['device']
        self.assertEqual(approved_payload['status'], 'active')

        # Pending device can now obtain refresh token by logging in with its id
        final_tokens = self._login(pending_id)
        self.assertIn('refresh', final_tokens)

    def test_rename_device_flow(self):
        primary_login = self._login()
        primary_link = self.client.post(
            self.device_link_url,
            {'label': 'Primary Web', 'platform': 'web'},
            format='json',
            **self._auth_headers(primary_login['access']),
        )
        self.assertEqual(primary_link.status_code, status.HTTP_200_OK)
        primary_device = primary_link.json()['device']
        primary_id = primary_device['device_id']

        primary_tokens = self._login(primary_id)

        rename_primary = self.client.post(
            self.device_rename_url,
            {'device_id': primary_id, 'label': 'المكتب الرئيسي'},
            format='json',
            **self._auth_headers(primary_tokens['access'], primary_id),
        )
        self.assertEqual(rename_primary.status_code, status.HTTP_200_OK)
        self.assertEqual(rename_primary.json()['device']['label'], 'المكتب الرئيسي')

        secondary_login = self._login()
        pending_resp = self.client.post(
            self.device_link_url,
            {'label': 'لوحي الفريق', 'platform': 'android'},
            format='json',
            **self._auth_headers(secondary_login['access']),
        )
        self.assertEqual(pending_resp.status_code, status.HTTP_200_OK)
        pending_device = pending_resp.json()['device']
        pending_id = pending_device['device_id']

        approve_resp = self.client.post(
            self.device_approve_url,
            {'device_id': pending_id},
            format='json',
            **self._auth_headers(primary_tokens['access'], primary_id),
        )
        self.assertEqual(approve_resp.status_code, status.HTTP_200_OK)

        rename_secondary = self.client.post(
            self.device_rename_url,
            {'device_id': pending_id, 'label': 'لوحي المكتب'},
            format='json',
            **self._auth_headers(primary_tokens['access'], primary_id),
        )
        self.assertEqual(rename_secondary.status_code, status.HTTP_200_OK)
        self.assertEqual(rename_secondary.json()['device']['label'], 'لوحي المكتب')

        secondary_tokens = self._login(pending_id)
        forbidden = self.client.post(
            self.device_rename_url,
            {'device_id': primary_id, 'label': 'محظور'},
            format='json',
            **self._auth_headers(secondary_tokens['access'], pending_id),
        )
        self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)

        rename_self = self.client.post(
            self.device_rename_url,
            {'device_id': pending_id, 'label': 'لوحي الميداني'},
            format='json',
            **self._auth_headers(secondary_tokens['access'], pending_id),
        )
        self.assertEqual(rename_self.status_code, status.HTTP_200_OK)
        self.assertEqual(rename_self.json()['device']['label'], 'لوحي الميداني')

        list_resp = self.client.get(self.device_list_url, **self._auth_headers(primary_tokens['access'], primary_id))
        self.assertEqual(list_resp.status_code, status.HTTP_200_OK)
        labels = {device['device_id']: device['label'] for device in list_resp.json()['devices']}
        self.assertEqual(labels[primary_id], 'المكتب الرئيسي')
        self.assertEqual(labels[pending_id], 'لوحي الميداني')
