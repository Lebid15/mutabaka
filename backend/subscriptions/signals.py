from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver
from django.utils import timezone

from .models import RenewalRequest


@receiver(pre_save, sender=RenewalRequest)
def detect_status_change(sender, instance: RenewalRequest, **kwargs):
    if not instance.pk:
        return
    try:
        prev = RenewalRequest.objects.get(pk=instance.pk)
    except RenewalRequest.DoesNotExist:
        return
    # If switching from pending to approved via manual admin form edit,
    # we need to apply the extension logic after saving.
    if prev.status == RenewalRequest.STATUS_PENDING and instance.status == RenewalRequest.STATUS_APPROVED:
        # Mark a transient flag on instance; will be read in post_save
        setattr(instance, "_apply_extension_after_save", True)
        # Ensure approved_at is set here to avoid saving again in post_save
        if not instance.approved_at:
            instance.approved_at = timezone.now()


@receiver(post_save, sender=RenewalRequest)
def apply_extension_on_manual_approval(sender, instance: RenewalRequest, created, **kwargs):
    # Only for existing records switched to approved outside the provided action
    if getattr(instance, "_apply_extension_after_save", False):
        try:
            months = 12 if instance.period == RenewalRequest.PERIOD_YEARLY else 1
            from .models import UserSubscription
            now = timezone.now()
            sub, _ = UserSubscription.objects.get_or_create(
                user=instance.user,
                defaults={
                    "plan": instance.plan,
                    "start_at": now,
                    "end_at": now,
                    "status": UserSubscription.STATUS_EXPIRED,
                },
            )
            sub.plan = instance.plan
            sub.extend(months)
            sub.save()
        except Exception:
            # Avoid breaking admin save; errors could be logged later
            pass
        finally:
            # Clear the transient flag to avoid re-trigger on any subsequent saves
            try:
                delattr(instance, "_apply_extension_after_save")
            except Exception:
                pass
