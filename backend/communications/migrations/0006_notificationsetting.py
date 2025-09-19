from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('communications', '0005_pushsubscription'),
    ]

    operations = [
        migrations.CreateModel(
            name='NotificationSetting',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('sound', models.FileField(blank=True, null=True, upload_to='notification_sounds/')),
                ('active', models.BooleanField(default=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'ordering': ['-updated_at', '-id'],
            },
        ),
    ]
