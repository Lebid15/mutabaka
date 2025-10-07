#!/usr/bin/env python
"""Add default custom emojis to database."""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mujard.settings')
django.setup()

from communications.models import CustomEmoji

# قائمة الإيموجي الافتراضية
DEFAULT_EMOJIS = ['😀','😂','😍','👍','🙏','🎉','💰','📌','❤️','😢','😎','🤔','✅','❌','🔥','🌟','🥰','😮','💡','📈','🤥','🌎']

def add_emojis():
    created_count = 0
    for i, emoji in enumerate(DEFAULT_EMOJIS):
        obj, created = CustomEmoji.objects.get_or_create(
            emoji=emoji,
            defaults={'display_order': i, 'is_active': True}
        )
        if created:
            created_count += 1
            print(f"✅ تم إضافة: {emoji}")
        else:
            print(f"⏭️ موجود مسبقاً: {emoji}")
    
    print(f"\n✨ تم! إضافة {created_count} إيموجي جديد")

if __name__ == '__main__':
    add_emojis()
