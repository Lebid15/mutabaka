from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.utils.translation import gettext_lazy as _
from django.db import models
from .models import CustomUser
from .forms import CustomUserChangeForm, CustomUserCreationForm

@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    form = CustomUserChangeForm
    add_form = CustomUserCreationForm
    list_display = ("id", "username", "display_name", "email", "first_name", "last_name", "country_code", "phone", "created_by")
    list_display_links = ("username",)
    list_editable = ("display_name",)
    search_fields = ("username", "display_name", "email", "phone", "first_name", "last_name")
    list_filter = ("country_code",)
    fieldsets = (
        (None, {"fields": ("username", "password", "email")}),
    (_("Personal info"), {"fields": ("first_name", "last_name", "display_name", "country_code", "phone", "logo")}),
        (_("Permissions"), {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        (_("Important dates"), {"fields": ("last_login", "date_joined", "last_password_change")}),
    )
    readonly_fields = ("last_password_change",)
    actions = ["reset_totp"]

    # Ensure the Add User form has our display_name and other fields
    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('username', 'password1', 'password2', 'email', 'first_name', 'last_name', 'display_name', 'country_code', 'phone', 'logo'),
        }),
        (_('Permissions'), {
            'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions'),
        }),
    )

    def save_form(self, request, form, change):
        # Ensure display_name is carried from the form into the instance
        obj = super().save_form(request, form, change)
        try:
            if form is not None and hasattr(form, 'cleaned_data') and 'display_name' in form.cleaned_data:
                obj.display_name = form.cleaned_data.get('display_name') or ''
        except Exception:
            pass
        return obj

    def save_model(self, request, obj, form, change):
        # Persist display_name explicitly from form if provided
        try:
            if form is not None and hasattr(form, 'cleaned_data') and 'display_name' in form.cleaned_data:
                obj.display_name = form.cleaned_data.get('display_name')
        except Exception:
            pass
        # If the password field was provided in plain text (no algorithm prefix), hash it.
        raw = form.cleaned_data.get('password')
        if raw and not raw.startswith('pbkdf2_'):
            obj.set_password(raw)
            obj.mark_password_changed()
        super().save_model(request, obj, form, change)
        # Show a clear confirmation with the latest value
        try:
            from django.contrib import messages
            messages.success(request, _("تم حفظ الاسم الظاهر: %s") % (obj.display_name or obj.username))
        except Exception:
            pass
        # After saving, broadcast a lightweight update to all conversation partners so UIs can refresh the name/avatar.
        try:
            # Lazy import to avoid circulars
            from communications.models import Conversation
            from communications.pusher_client import pusher_client
            if pusher_client:
                # Find all distinct partners who have a conversation with this user
                qs = Conversation.objects.filter(models.Q(user_a=obj) | models.Q(user_b=obj))
                partner_ids = set()
                for c in qs.only('user_a_id', 'user_b_id'):
                    if c.user_a_id == obj.id:
                        partner_ids.add(c.user_b_id)
                    else:
                        partner_ids.add(c.user_a_id)
                payload = {
                    'type': 'user.updated',
                    'user': {
                        'id': obj.id,
                        'username': obj.username,
                        'display_name': getattr(obj, 'display_name', '') or obj.username,
                    }
                }
                for pid in partner_ids:
                    try:
                        pusher_client.trigger(f"user_{pid}", 'notify', payload)
                    except Exception:
                        pass
        except Exception:
            # Silently ignore broadcasting errors; admin save should not fail due to Pusher issues
            pass

    @admin.action(description=_("Reset TOTP (2FA) for selected users"))
    def reset_totp(self, request, queryset):
        updated = 0
        for user in queryset:
            try:
                user.totp_secret = ""
                user.totp_enabled = False
                user.save(update_fields=["totp_secret", "totp_enabled"])
                updated += 1
            except Exception:
                pass
        try:
            from django.contrib import messages
            messages.success(request, _("تم تصفير التحقق الثنائي لعدد %d مستخدم") % updated)
        except Exception:
            pass
