from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0004_add_totp_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='pin_hash',
            field=models.CharField(default='', blank=True, max_length=256),
        ),
        migrations.AddField(
            model_name='customuser',
            name='pin_initialized_at',
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='customuser',
            name='pin_failed_attempts',
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name='customuser',
            name='pin_locked_until',
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.CreateModel(
            name='TrustedDevice',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fingerprint', models.CharField(max_length=128, help_text='Stable device fingerprint provided by the app')),
                ('device_name', models.CharField(blank=True, max_length=120)),
                ('platform', models.CharField(blank=True, help_text='ios|android|other', max_length=40)),
                ('approved_at', models.DateTimeField(blank=True, null=True)),
                ('last_seen_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='trusted_devices', to='accounts.customuser')),
            ],
            options={
                'indexes': [
                    models.Index(fields=['user', 'approved_at'], name='accounts_tr_user_id_5f1f2d_idx'),
                    models.Index(fields=['user', 'fingerprint'], name='accounts_tr_user_id_1c9b4a_idx'),
                ],
                'unique_together': {('user', 'fingerprint')},
            },
        ),
    ]
