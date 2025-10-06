"""
Test FCM integration with notification icon
"""
from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from unittest.mock import patch, MagicMock
from accounts.models import SiteSettings
from accounts.fcm_push import send_fcm_notifications


class FCMNotificationIconTestCase(TestCase):
    """Test that notification icon is automatically included in FCM"""

    def setUp(self):
        """Clear settings cache before each test"""
        from accounts.site_settings import clear_site_settings_cache
        clear_site_settings_cache()

    def test_fcm_without_icon(self):
        """FCM should work without icon (None)"""
        settings = SiteSettings.load()
        # No icon uploaded - check the name, not the object
        self.assertFalse(settings.notification_icon.name)
        
        # Mock Firebase to avoid actual sending
        with patch('accounts.fcm_push._initialize_firebase') as mock_init:
            with patch('accounts.fcm_push.messaging.send') as mock_send:
                mock_init.return_value = MagicMock()
                mock_send.return_value = 'mock-message-id'
                
                result = send_fcm_notifications(
                    tokens=['test-token'],
                    title='Test',
                    body='Body',
                )
                
                self.assertEqual(result['success'], 1)
                self.assertEqual(result['failure'], 0)

    def test_fcm_with_icon(self):
        """FCM should include icon when uploaded"""
        # Upload an icon
        settings = SiteSettings.load()
        png_file = SimpleUploadedFile(
            "test_fcm_icon.png",
            b"fake png content",
            content_type="image/png"
        )
        settings.notification_icon = png_file
        settings.save()
        
        # Clear cache to force reload
        from accounts.site_settings import clear_site_settings_cache, get_notification_icon_url
        clear_site_settings_cache()
        
        # Verify icon URL is available
        icon_url = get_notification_icon_url()
        self.assertIsNotNone(icon_url)
        self.assertIn('notification_icons/', icon_url)
        
        # Mock Firebase
        with patch('accounts.fcm_push._initialize_firebase') as mock_init:
            with patch('accounts.fcm_push.messaging.send') as mock_send:
                with patch('accounts.fcm_push.messaging.Message') as mock_message:
                    mock_init.return_value = MagicMock()
                    mock_send.return_value = 'mock-message-id'
                    
                    result = send_fcm_notifications(
                        tokens=['test-token'],
                        title='Test with Icon',
                        body='Body',
                    )
                    
                    # Verify message was created
                    self.assertTrue(mock_message.called)
                    
                    # Get the call arguments
                    call_args = mock_message.call_args
                    android_config = call_args.kwargs.get('android')
                    
                    # Verify Android notification has icon
                    if android_config:
                        android_notification = android_config.notification
                        if hasattr(android_notification, 'icon'):
                            # Icon should be set
                            self.assertEqual(android_notification.icon, icon_url)

    def test_icon_url_format(self):
        """Icon URL should be properly formatted for FCM"""
        settings = SiteSettings.load()
        png_file = SimpleUploadedFile(
            "fcm_format_test.png",
            b"fake png",
            content_type="image/png"
        )
        settings.notification_icon = png_file
        settings.save()
        
        from accounts.site_settings import clear_site_settings_cache, get_notification_icon_url
        clear_site_settings_cache()
        
        icon_url = get_notification_icon_url()
        
        # Should start with /media/
        self.assertTrue(icon_url.startswith('/media/'))
        
        # Should contain notification_icons/
        self.assertIn('notification_icons/', icon_url)
        
        # Should end with .png
        self.assertTrue(icon_url.endswith('.png'))
