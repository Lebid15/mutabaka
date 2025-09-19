from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('communications', '0002_conversation_last_activity_at_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='transaction',
            name='amount',
            field=models.DecimalField(max_digits=18, decimal_places=5),
        ),
        migrations.AlterField(
            model_name='transaction',
            name='balance_after_from',
            field=models.DecimalField(max_digits=18, decimal_places=5, null=True, blank=True),
        ),
        migrations.AlterField(
            model_name='transaction',
            name='balance_after_to',
            field=models.DecimalField(max_digits=18, decimal_places=5, null=True, blank=True),
        ),
    ]
