from django.db import migrations


def backfill_display_name(apps, schema_editor):
    User = apps.get_model('accounts', 'CustomUser')
    for u in User.objects.all():
        if not getattr(u, 'display_name', ''):
            name = (u.first_name or '').strip()
            if u.last_name:
                name = (name + ' ' + u.last_name.strip()).strip()
            if not name:
                name = u.username or ''
            u.display_name = name[:150]
            u.save(update_fields=['display_name'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0002_customuser_display_name'),
    ]

    operations = [
        migrations.RunPython(backfill_display_name, noop),
    ]
