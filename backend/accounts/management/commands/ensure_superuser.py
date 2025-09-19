from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
import os

class Command(BaseCommand):
    help = "Ensure a superuser exists. Creates one using env vars if missing."

    def handle(self, *args, **options):
        User = get_user_model()
        username = os.environ.get('ADMIN_USERNAME', 'admin')
        email = os.environ.get('ADMIN_EMAIL', 'admin@example.com')
        password = os.environ.get('ADMIN_PASSWORD', 'admin123')

        existing_su = User.objects.filter(is_superuser=True).first()
        if existing_su:
            updated = False
            if existing_su.email != email:
                existing_su.email = email
                updated = True
            # Always reset password to provided one for idempotent provisioning
            existing_su.set_password(password)
            updated = True
            existing_su.save()
            self.stdout.write(self.style.SUCCESS(f'Superuser updated ({existing_su.username}) with provided credentials.'))
            return

        if User.objects.filter(username=username).exists():
            user = User.objects.get(username=username)
            user.is_staff = True
            user.is_superuser = True
            user.set_password(password)
            user.save()
            self.stdout.write(self.style.WARNING('Existing user upgraded to superuser.'))
            return

        user = User.objects.create_user(
            username=username,
            email=email,
            password=password,
            first_name='Admin',
            last_name='User'
        )
        user.is_staff = True
        user.is_superuser = True
        user.save()
        self.stdout.write(self.style.SUCCESS(f'Superuser created: {username} / {password}'))
