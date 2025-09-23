from django.db import migrations


class Migration(migrations.Migration):
    # Empty migration to neutralize previously added 0005; safe to keep history consistent
    dependencies = [
        ('accounts', '0004_add_totp_fields'),
    ]

    operations = []
