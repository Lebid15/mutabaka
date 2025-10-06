#!/usr/bin/env python
"""
سكريبت للتحقق من تثبيت ميزة أيقونة الإشعارات بنجاح
Verification script for Notification Icon feature installation
"""

import os
import sys
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')
django.setup()

from accounts.models import SiteSettings
from accounts.site_settings import get_site_settings, get_notification_icon_url


def check_model():
    """التحقق من النموذج"""
    try:
        settings = SiteSettings.load()
        print("✅ نموذج SiteSettings موجود ويعمل")
        print(f"   - ID: {settings.pk}")
        print(f"   - Updated: {settings.updated_at}")
        return True
    except Exception as e:
        print(f"❌ خطأ في النموذج: {e}")
        return False


def check_helper_functions():
    """التحقق من الدوال المساعدة"""
    try:
        settings = get_site_settings()
        icon_url = get_notification_icon_url()
        print("✅ الدوال المساعدة تعمل بنجاح")
        print(f"   - get_site_settings(): {settings}")
        print(f"   - get_notification_icon_url(): {icon_url or 'None (no icon uploaded)'}")
        return True
    except Exception as e:
        print(f"❌ خطأ في الدوال المساعدة: {e}")
        return False


def check_admin():
    """التحقق من تسجيل Admin"""
    try:
        from django.contrib.admin.sites import site
        from accounts.admin import SiteSettingsAdmin
        
        if SiteSettings in site._registry:
            admin_class = site._registry[SiteSettings]
            print("✅ SiteSettings مسجل في Django Admin")
            print(f"   - Admin class: {admin_class.__class__.__name__}")
            print(f"   - Has preview: {'notification_icon_preview' in admin_class.readonly_fields}")
            return True
        else:
            print("❌ SiteSettings غير مسجل في Admin")
            return False
    except Exception as e:
        print(f"❌ خطأ في التحقق من Admin: {e}")
        return False


def check_migration():
    """التحقق من تطبيق Migration"""
    try:
        from django.db.migrations.recorder import MigrationRecorder
        recorder = MigrationRecorder.Migration
        migration = recorder.objects.filter(
            app='accounts',
            name='0010_sitesettings'
        ).first()
        
        if migration:
            print("✅ Migration 0010_sitesettings مُطبّق بنجاح")
            print(f"   - Applied at: {migration.applied}")
            return True
        else:
            print("❌ Migration لم يُطبّق بعد")
            return False
    except Exception as e:
        print(f"❌ خطأ في التحقق من Migration: {e}")
        return False


def check_database_table():
    """التحقق من وجود الجدول في قاعدة البيانات"""
    try:
        from django.db import connection
        cursor = connection.cursor()
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='accounts_sitesettings'"
        )
        result = cursor.fetchone()
        
        if result:
            # Count records
            count = SiteSettings.objects.count()
            print("✅ جدول accounts_sitesettings موجود")
            print(f"   - عدد السجلات: {count}")
            return True
        else:
            print("❌ الجدول غير موجود في قاعدة البيانات")
            return False
    except Exception as e:
        print(f"❌ خطأ في التحقق من الجدول: {e}")
        return False


def check_validator():
    """التحقق من validator للـ PNG"""
    try:
        from accounts.models import validate_png_only
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.core.exceptions import ValidationError
        
        # Test valid PNG
        png_file = SimpleUploadedFile("test.png", b"fake", content_type="image/png")
        validate_png_only(png_file)
        
        # Test invalid JPG
        jpg_file = SimpleUploadedFile("test.jpg", b"fake", content_type="image/jpeg")
        try:
            validate_png_only(jpg_file)
            print("❌ Validator لا يعمل بشكل صحيح (قبل JPG)")
            return False
        except ValidationError:
            print("✅ Validator يعمل بشكل صحيح (يرفض غير PNG)")
            return True
    except Exception as e:
        print(f"❌ خطأ في Validator: {e}")
        return False


def main():
    """تشغيل جميع الفحوصات"""
    print("=" * 60)
    print("🔍 التحقق من تثبيت ميزة أيقونة الإشعارات")
    print("=" * 60)
    print()
    
    checks = [
        ("قاعدة البيانات", check_database_table),
        ("Migration", check_migration),
        ("النموذج", check_model),
        ("الدوال المساعدة", check_helper_functions),
        ("Django Admin", check_admin),
        ("Validator", check_validator),
    ]
    
    results = []
    for name, check_func in checks:
        print(f"\n📝 فحص: {name}")
        print("-" * 40)
        result = check_func()
        results.append(result)
        print()
    
    print("=" * 60)
    print("📊 النتيجة النهائية")
    print("=" * 60)
    
    passed = sum(results)
    total = len(results)
    
    print(f"✅ نجح: {passed}/{total}")
    print(f"❌ فشل: {total - passed}/{total}")
    print()
    
    if passed == total:
        print("🎉 جميع الفحوصات نجحت! الميزة مثبتة بشكل صحيح.")
        print()
        print("📚 الخطوات التالية:")
        print("   1. افتح Django Admin: /admin/accounts/sitesettings/")
        print("   2. ارفع صورة PNG للأيقونة")
        print("   3. استخدم: from accounts.site_settings import get_notification_icon_url")
        print()
        return 0
    else:
        print("⚠️ بعض الفحوصات فشلت. راجع الأخطاء أعلاه.")
        return 1


if __name__ == '__main__':
    sys.exit(main())
