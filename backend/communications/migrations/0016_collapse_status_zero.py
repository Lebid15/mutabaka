from django.db import migrations


def promote_zero_to_one(apps, schema_editor):
    Message = apps.get_model('communications', 'Message')
    # Promote all existing 0 -> 1 (delivered). read_at سيتم لاحقاً رفعه إلى 2 بواسطة منطق القراءة.
    Message.objects.filter(delivery_status=0).update(delivery_status=1)


def reverse_noop(apps, schema_editor):
    # لا عودة (تركها كما هي)
    pass

class Migration(migrations.Migration):
    dependencies = [
        ('communications', '0015_message_delivery_status'),
    ]

    operations = [
        migrations.RunPython(promote_zero_to_one, reverse_noop),
    ]
