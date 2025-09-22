from django.db import migrations


def create_trial_plan(apps, schema_editor):
    SubscriptionPlan = apps.get_model('subscriptions', 'SubscriptionPlan')
    SubscriptionPlan.objects.get_or_create(code='trial', defaults={
        'name': 'Trial',
        'monthly_price': None,
        'yearly_price': None,
        'yearly_discount_percent': None,
    })


class Migration(migrations.Migration):
    dependencies = [
        ('subscriptions', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(create_trial_plan, migrations.RunPython.noop),
    ]
