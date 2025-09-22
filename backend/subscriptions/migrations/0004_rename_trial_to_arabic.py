from django.db import migrations


def set_trial_name_ar(apps, schema_editor):
    SubscriptionPlan = apps.get_model('subscriptions', 'SubscriptionPlan')
    try:
        plan = SubscriptionPlan.objects.filter(code='trial').first()
        if plan:
            plan.name = 'مجاني'
            plan.save(update_fields=['name'])
    except Exception:
        pass


class Migration(migrations.Migration):
    dependencies = [
        ('subscriptions', '0003_alter_subscriptionplan_code'),
    ]

    operations = [
        migrations.RunPython(set_trial_name_ar, migrations.RunPython.noop),
    ]
