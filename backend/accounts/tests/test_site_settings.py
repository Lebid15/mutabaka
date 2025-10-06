"""
Tests for SiteSettings model and notification icon functionality
"""
from django.test import TestCase
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from accounts.models import SiteSettings, validate_png_only
from accounts.site_settings import (
    get_site_settings,
    get_notification_icon_url,
    clear_site_settings_cache
)


class ValidatePNGOnlyTestCase(TestCase):
    """Test the PNG-only validator"""

    def test_valid_png_file(self):
        """Valid PNG file should pass validation"""
        png_file = SimpleUploadedFile(
            "test_icon.png",
            b"fake png content",
            content_type="image/png"
        )
        # Should not raise
        validate_png_only(png_file)

    def test_invalid_jpg_file(self):
        """JPG file should fail validation"""
        jpg_file = SimpleUploadedFile(
            "test_icon.jpg",
            b"fake jpg content",
            content_type="image/jpeg"
        )
        with self.assertRaises(ValidationError) as cm:
            validate_png_only(jpg_file)
        self.assertIn('PNG', str(cm.exception))

    def test_invalid_jpeg_file(self):
        """JPEG file should fail validation"""
        jpeg_file = SimpleUploadedFile(
            "test_icon.jpeg",
            b"fake jpeg content",
            content_type="image/jpeg"
        )
        with self.assertRaises(ValidationError):
            validate_png_only(jpeg_file)

    def test_none_file(self):
        """None/empty file should pass (optional field)"""
        # Should not raise
        validate_png_only(None)


class SiteSettingsTestCase(TestCase):
    """Test SiteSettings model functionality"""

    def setUp(self):
        """Clear cache before each test"""
        clear_site_settings_cache()

    def test_singleton_pattern(self):
        """Only one SiteSettings instance should exist"""
        settings1 = SiteSettings.load()
        settings2 = SiteSettings.load()
        
        self.assertEqual(settings1.pk, 1)
        self.assertEqual(settings2.pk, 1)
        self.assertEqual(settings1.pk, settings2.pk)

    def test_save_enforces_pk_1(self):
        """Save should always enforce pk=1"""
        settings = SiteSettings()
        settings.save()
        self.assertEqual(settings.pk, 1)
        
        # Try to create with different pk
        settings2 = SiteSettings(pk=999)
        settings2.save()
        self.assertEqual(settings2.pk, 1)

    def test_get_notification_icon_url_no_icon(self):
        """Should return None when no icon is set"""
        settings = SiteSettings.load()
        url = settings.get_notification_icon_url()
        self.assertIsNone(url)

    def test_get_notification_icon_url_with_icon(self):
        """Should return proper URL when icon is set"""
        settings = SiteSettings.load()
        png_file = SimpleUploadedFile(
            "test_notification.png",
            b"fake png content",
            content_type="image/png"
        )
        settings.notification_icon = png_file
        settings.save()
        
        url = settings.get_notification_icon_url()
        self.assertIsNotNone(url)
        self.assertIn('/media/', url)
        self.assertIn('notification_icons/', url)
        self.assertTrue(url.endswith('.png'))

    def test_str_representation(self):
        """String representation should be in Arabic"""
        settings = SiteSettings.load()
        self.assertEqual(str(settings), 'إعدادات الموقع')


class SiteSettingsHelpersTestCase(TestCase):
    """Test helper functions in site_settings module"""

    def setUp(self):
        """Clear cache before each test"""
        clear_site_settings_cache()

    def test_get_site_settings(self):
        """Should return the singleton instance"""
        settings = get_site_settings()
        self.assertIsInstance(settings, SiteSettings)
        self.assertEqual(settings.pk, 1)

    def test_get_site_settings_caching(self):
        """Should use cached instance on subsequent calls"""
        settings1 = get_site_settings()
        settings2 = get_site_settings()
        # Should be the same Python object (cached)
        self.assertIs(settings1, settings2)

    def test_clear_cache(self):
        """Cache should be cleared and new instance fetched"""
        settings1 = get_site_settings()
        clear_site_settings_cache()
        settings2 = get_site_settings()
        # Should be different Python objects
        self.assertIsNot(settings1, settings2)
        # But same database record
        self.assertEqual(settings1.pk, settings2.pk)

    def test_get_notification_icon_url_helper_no_icon(self):
        """Helper should return None when no icon"""
        url = get_notification_icon_url()
        self.assertIsNone(url)

    def test_get_notification_icon_url_helper_with_icon(self):
        """Helper should return URL when icon exists"""
        settings = SiteSettings.load()
        png_file = SimpleUploadedFile(
            "helper_test.png",
            b"fake png content",
            content_type="image/png"
        )
        settings.notification_icon = png_file
        settings.save()
        clear_site_settings_cache()
        
        url = get_notification_icon_url()
        self.assertIsNotNone(url)
        self.assertIn('notification_icons/', url)

    def test_cache_cleared_on_save(self):
        """Cache should be automatically cleared when settings are saved"""
        # Get initial settings
        settings1 = get_site_settings()
        
        # Modify and save
        settings = SiteSettings.load()
        png_file = SimpleUploadedFile(
            "cache_test.png",
            b"fake png content",
            content_type="image/png"
        )
        settings.notification_icon = png_file
        settings.save()
        
        # Get settings again - should be fresh from DB
        settings2 = get_site_settings()
        self.assertIsNotNone(settings2.notification_icon)
