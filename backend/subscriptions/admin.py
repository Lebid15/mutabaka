from django.contrib import admin, messages
from django.utils import timezone
from django import forms

from .models import SubscriptionPlan, UserSubscription, RenewalRequest


@admin.register(SubscriptionPlan)
class SubscriptionPlanAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "monthly_price", "yearly_price", "yearly_discount_percent")
    search_fields = ("code", "name")


class ChangePlanForm(forms.Form):
    plan = forms.ModelChoiceField(queryset=SubscriptionPlan.objects.all())


@admin.register(UserSubscription)
class UserSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("user", "plan", "start_at", "end_at", "status")
    list_filter = ("status", "plan")
    search_fields = ("user__username", "user__first_name", "user__last_name")
    actions = ("renew_1_month", "renew_12_months", "change_plan_action",)

    @admin.action(description="تجديد 1 شهر")
    def renew_1_month(self, request, queryset):
        count = 0
        now = timezone.now()
        for sub in queryset:
            sub.extend(1, use_from=now)
            sub.save()
            count += 1
        self.message_user(request, f"تم تجديد {count} اشتراكاً لشهر واحد.", messages.SUCCESS)

    @admin.action(description="تجديد 12 شهرًا")
    def renew_12_months(self, request, queryset):
        count = 0
        now = timezone.now()
        for sub in queryset:
            sub.extend(12, use_from=now)
            sub.save()
            count += 1
        self.message_user(request, f"تم تجديد {count} اشتراكاً لمدة 12 شهرًا.", messages.SUCCESS)

    @admin.action(description="تغيير الباقة")
    def change_plan_action(self, request, queryset):
        # Simplified: change to selected plan via POST parameter
        if "apply" in request.POST:
            form = ChangePlanForm(request.POST)
            if form.is_valid():
                plan = form.cleaned_data["plan"]
                for sub in queryset:
                    sub.plan = plan
                    sub.save(update_fields=["plan"])
                self.message_user(request, f"تم تغيير الباقة لعدد {queryset.count()} اشتراك.")
                return
        else:
            form = ChangePlanForm()
        context = {
            **self.admin_site.each_context(request),
            "title": "تغيير الباقة للأشتراكات المحددة",
            "queryset": queryset,
            "action_checkbox_name": admin.helpers.ACTION_CHECKBOX_NAME,
            "form": form,
        }
        from django.shortcuts import render
        return render(request, "admin/change_plan_action.html", context)


@admin.register(RenewalRequest)
class RenewalRequestAdmin(admin.ModelAdmin):
    list_display = ("user", "plan", "period", "status", "created_at", "approved_by", "approved_at")
    list_filter = ("status", "period", "plan", "created_at")
    search_fields = ("user__username", "plan__code")
    actions = ("approve_requests", "reject_requests")

    def save_model(self, request, obj, form, change):
        # If status changed from pending to approved via the form, set approved_by
        if change and 'status' in form.changed_data:
            try:
                prev = type(obj).objects.get(pk=obj.pk)
            except type(obj).DoesNotExist:
                prev = None
            if prev and prev.status == RenewalRequest.STATUS_PENDING and obj.status == RenewalRequest.STATUS_APPROVED:
                obj.approved_by = request.user
                if not obj.approved_at:
                    from django.utils import timezone
                    obj.approved_at = timezone.now()
        super().save_model(request, obj, form, change)

    @admin.action(description="Approve selected")
    def approve_requests(self, request, queryset):
        count = 0
        for req in queryset:
            if req.status == RenewalRequest.STATUS_PENDING:
                req.approve(request.user)
                count += 1
        self.message_user(request, f"Approved {count} requests", level=messages.SUCCESS)

    @admin.action(description="Reject selected")
    def reject_requests(self, request, queryset):
        count = 0
        for req in queryset:
            if req.status == RenewalRequest.STATUS_PENDING:
                req.reject(request.user, reason="Rejected via bulk action")
                count += 1
        self.message_user(request, f"Rejected {count} requests", level=messages.WARNING)
