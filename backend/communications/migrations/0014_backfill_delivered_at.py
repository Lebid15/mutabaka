from django.db import migrations, models
from django.utils import timezone


def backfill_delivered(apps, schema_editor):
    Message = apps.get_model('communications', 'Message')
    # Set delivered_at to created_at where it's null
    try:
        Message.objects.filter(delivered_at__isnull=True).update(delivered_at=models.F('created_at'))
    except Exception:
        # Fallback: set to now if F expression not available
        now = timezone.now()
        try:
            Message.objects.filter(delivered_at__isnull=True).update(delivered_at=now)
        except Exception:
            pass


class Migration(migrations.Migration):
    dependencies = [
        ('communications', '0013_message_delivered_at_message_read_at'),
    ]

    operations = [
        migrations.RunPython(backfill_delivered, migrations.RunPython.noop),
    ]
