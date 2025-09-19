from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('communications', '0007_conversationmute'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='attachment',
            field=models.FileField(blank=True, null=True, upload_to='attachments/'),
        ),
        migrations.AddField(
            model_name='message',
            name='attachment_name',
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name='message',
            name='attachment_mime',
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name='message',
            name='attachment_size',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
