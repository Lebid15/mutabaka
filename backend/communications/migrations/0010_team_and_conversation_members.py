from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings


class Migration(migrations.Migration):

    dependencies = [
        ('communications', '0009_conversationinbox'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='TeamMember',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('display_name', models.CharField(blank=True, max_length=150)),
                ('phone', models.CharField(blank=True, max_length=32)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('member', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='member_of_teams', to=settings.AUTH_USER_MODEL)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='team_members', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'indexes': [models.Index(fields=['owner', 'member'], name='comm_team_owner_member_idx')],
                'unique_together': {('owner', 'member')},
            },
        ),
        migrations.CreateModel(
            name='ConversationMember',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('added_by', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='added_conversation_members', to=settings.AUTH_USER_MODEL)),
                ('conversation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='extra_members', to='communications.conversation')),
                ('member', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='conversation_memberships', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'indexes': [models.Index(fields=['conversation', 'member'], name='comm_conv_member_idx')],
                'unique_together': {('conversation', 'member')},
            },
        ),
    ]
