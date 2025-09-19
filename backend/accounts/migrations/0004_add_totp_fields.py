from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0003_backfill_display_name'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='totp_secret',
            field=models.CharField(blank=True, default='', help_text='Base32 secret for TOTP; empty = not configured', max_length=64),
        ),
        migrations.AddField(
            model_name='customuser',
            name='totp_enabled',
            field=models.BooleanField(default=False),
        ),
    ]
