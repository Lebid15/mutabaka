from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver
from django.utils import timezone

from django.contrib.auth import get_user_model

from .models import RenewalRequest, SubscriptionPlan, UserSubscription


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


# --- Trial subscription on new user creation ---
@receiver(post_save, sender=get_user_model())
def grant_trial_on_user_creation(sender, instance, created, **kwargs):
    if not created:
        return
    user = instance
    # Skip if any subscription already exists
    if hasattr(user, "subscription") and user.subscription is not None:
        return
    try:
        plan = SubscriptionPlan.objects.filter(code="trial").first()
        # If no explicit trial plan exists, fallback to lowest tier available
        if plan is None:
            plan = SubscriptionPlan.objects.order_by("code").first()
        if plan is None:
            return  # no plans configured yet
        now = timezone.now()
        start = getattr(user, "date_joined", None) or now
        end = start + timezone.timedelta(days=30)
        UserSubscription.objects.create(
            user=user,
            plan=plan,
            start_at=start,
            end_at=end,
            status=UserSubscription.STATUS_ACTIVE,
            notes="Auto-granted 1-month trial",
        )
    except Exception:
        # Avoid blocking user creation due to subscription issues
        pass
