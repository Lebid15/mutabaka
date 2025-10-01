from django.db import migrations

NEW_BODY = "الحساب صفر"
OLD_BODIES = [
    "✅ تمت تسوية جميع المحافظ بين الطرفين.",
    "تمت تسوية جميع المحافظ بين الطرفين.",
    "تم تصفير جميع المحافظ بين الطرفين.",
]


def _update_conversation_preview(conversation_model, conversation_id, message_created_at, preview_text):
    conversation_model.objects.filter(
        pk=conversation_id,
        last_message_at=message_created_at,
    ).update(last_message_preview=preview_text[:120])


def forwards(apps, schema_editor):
    Message = apps.get_model("communications", "Message")
    Conversation = apps.get_model("communications", "Conversation")

    for old_body in OLD_BODIES:
        qs = Message.objects.filter(type="system", body=old_body).only("pk", "conversation_id", "created_at")
        for msg in qs.iterator():
            Message.objects.filter(pk=msg.pk).update(body=NEW_BODY)
            _update_conversation_preview(Conversation, msg.conversation_id, msg.created_at, NEW_BODY)


def backwards(apps, schema_editor):
    Message = apps.get_model("communications", "Message")
    Conversation = apps.get_model("communications", "Conversation")
    fallback_body = OLD_BODIES[0]

    qs = Message.objects.filter(type="system", body=NEW_BODY).only("pk", "conversation_id", "created_at")
    for msg in qs.iterator():
        Message.objects.filter(pk=msg.pk).update(body=fallback_body)
        _update_conversation_preview(Conversation, msg.conversation_id, msg.created_at, fallback_body)


class Migration(migrations.Migration):

    dependencies = [
        ("communications", "0026_conversation_last_settled_at_conversationsettlement"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
