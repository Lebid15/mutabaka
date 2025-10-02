from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0006_rename_accounts_tr_user_id_5f1f2d_idx_accounts_tr_user_id_87a2de_idx_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='pin_enabled',
            field=models.BooleanField(default=False, help_text='Whether local device PIN login is currently allowed'),
        ),
        migrations.AddField(
            model_name='customuser',
            name='pin_epoch',
            field=models.PositiveIntegerField(default=0, help_text='Bumps whenever admin resets to invalidate local caches'),
        ),
        migrations.CreateModel(
            name='UserSecurityAudit',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(choices=[('pin_reset', 'PIN Reset')], max_length=64)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('actor', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='security_actions_performed', to='accounts.customuser')),
                ('subject', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='security_audit_entries', to='accounts.customuser')),
            ],
            options={
                'ordering': ['-created_at'],
                'indexes': [
                    models.Index(fields=['subject', 'created_at'], name='accounts_us_subject_951f2c_idx'),
                    models.Index(fields=['action', 'created_at'], name='accounts_us_action_9e2654_idx'),
                ],
            },
        ),
    ]
