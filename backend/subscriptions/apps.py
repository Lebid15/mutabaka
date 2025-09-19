from django.apps import AppConfig


class SubscriptionsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'subscriptions'
    verbose_name = 'Subscriptions'

    def ready(self):  # pragma: no cover - import side effects
        from . import signals  # noqa: F401
