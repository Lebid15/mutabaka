from django.db import migrations, models
from django.utils import timezone


def backfill_delivery_status(apps, schema_editor):
    Message = apps.get_model('communications', 'Message')
    # 0=SENT, 1=DELIVERED, 2=READ
    try:
        # READ where read_at set
        Message.objects.filter(read_at__isnull=False).update(delivery_status=2)
        # DELIVERED where delivered_at set and not already READ
        Message.objects.filter(read_at__isnull=True, delivered_at__isnull=False).update(delivery_status=1)
        # SENT otherwise (default 0)
    except Exception:
        pass


class Migration(migrations.Migration):
    dependencies = [
        ('communications', '0014_backfill_delivered_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='delivery_status',
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.RunPython(backfill_delivery_status, migrations.RunPython.noop),
    ]
