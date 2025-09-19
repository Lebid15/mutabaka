from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model

User = get_user_model()

class Command(BaseCommand):
    help = (
        "Set (reset) a user's password by username or email.\n"
        "Examples:\n"
        "  python manage.py set_user_password --username lebid --password 11112222\n"
        "  python manage.py set_user_password --email user@example.com --password 12345678\n"
        "(Legacy) python manage.py set_user_password --id lebid --password 12345678"
    )

    def add_arguments(self, parser):
        parser.add_argument('--id', dest='legacy_identifier', help='(Legacy) Username or email')
        parser.add_argument('--username', dest='username', help='Username')
        parser.add_argument('--email', dest='email', help='Email address')
        parser.add_argument('--password', dest='password', required=True, help='New password')

    def handle(self, *args, **options):
        username = options.get('username')
        email = options.get('email')
        legacy = options.get('legacy_identifier')
        password = options['password']

        if not (username or email or legacy):
            raise CommandError('Provide --username OR --email (or legacy --id)')

        ident = username or email or legacy
        user = None
        # Try username first if provided or legacy
        if username or legacy:
            try:
                user = User.objects.get(username__iexact=ident)
            except User.DoesNotExist:
                user = None
        if user is None and (email or legacy):
            try:
                user = User.objects.get(email__iexact=ident)
            except User.DoesNotExist:
                user = None
        if user is None:
            raise CommandError('User not found')

        user.set_password(password)
        user.save(update_fields=['password'])
        self.stdout.write(self.style.SUCCESS(f'Password updated for user {user.username}'))
