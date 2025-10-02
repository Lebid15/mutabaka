from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.utils.translation import gettext_lazy as _
from django.db import models
from django.urls import reverse
from .models import CustomUser, UserSecurityAudit
from .forms import CustomUserChangeForm, CustomUserCreationForm

@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    form = CustomUserChangeForm
    add_form = CustomUserCreationForm
    # Use our app-specific change_form template for the Add view as well,
    # so custom JS/CSS tweaks apply consistently and tabs don't stack.
    add_form_template = 'admin/accounts/customuser/change_form.html'
    list_display = ("id", "username", "display_name", "email", "first_name", "last_name", "country_code", "phone", "created_by")
    list_display_links = ("username",)
    list_editable = ("display_name",)
    search_fields = ("username", "display_name", "email", "phone", "first_name", "last_name")
    list_filter = ("country_code",)
    # Change view fieldsets (displayed when editing an existing user)
    # Each field should appear only once across tabs.
    fieldsets = (
        # General tab
        (None, {"classes": ("tab", "general"), "fields": ("username", "password", "email")}),
        (_("Personal info"), {"classes": ("tab", "general"), "fields": ("first_name", "last_name", "display_name", "country_code", "phone", "logo")}),
        # Permissions tab
        (_("Permissions"), {"classes": ("tab", "permissions"), "fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        # Keep dates outside tabs (or make them collapsed)
        (_("Important dates"), {"classes": ("collapse",), "fields": ("last_login", "date_joined", "last_password_change")}),
    )
    readonly_fields = ("last_password_change",)
    actions = ["reset_totp"]
    # Control section order for Jazzmin tabs to avoid any re-ordering quirks
    jazzmin_section_order = ("General", "Personal info", "Permissions", "Important dates")

    # Add view fieldsets (displayed when creating a new user)
    # Use password1/password2 here and DO NOT repeat fields across tabs.
    add_fieldsets = (
        (_('General'), {
            'classes': ('wide', 'tab', 'general'),
            'fields': ('username', 'password1', 'password2', 'email', 'first_name', 'last_name', 'display_name', 'country_code', 'phone', 'logo'),
        }),
        (_('Permissions'), {
            'classes': ('tab', 'permissions'),
            'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions'),
        }),
    )

    def get_fieldsets(self, request, obj=None):
        """Ensure add view uses add_fieldsets only, avoiding duplication with fieldsets when Jazzmin tabs are enabled."""
        if obj is None:
            return self.add_fieldsets
        return super().get_fieldsets(request, obj)

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

    def changeform_view(self, request, object_id=None, form_url='', extra_context=None):
        extra_context = extra_context or {}
        if object_id:
            try:
                audit_entries = (
                    UserSecurityAudit.objects
                    .filter(subject_id=object_id)
                    .select_related('actor')[:10]
                )
            except Exception:
                audit_entries = UserSecurityAudit.objects.none()
            extra_context['pin_audit_entries'] = audit_entries
            try:
                extra_context['pin_reset_url'] = reverse('pin_reset')
            except Exception:
                extra_context['pin_reset_url'] = ''
        return super().changeform_view(request, object_id, form_url, extra_context)

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


@admin.register(UserSecurityAudit)
class UserSecurityAuditAdmin(admin.ModelAdmin):
    list_display = ("id", "action", "subject", "actor", "created_at")
    list_filter = ("action", "created_at")
    search_fields = ("subject__username", "actor__username")
    autocomplete_fields = ("subject", "actor")
    readonly_fields = ("action", "subject", "actor", "metadata", "created_at")
    ordering = ("-created_at",)

    def has_add_permission(self, request):  # pragma: no cover - audit entries are system generated
        return False

    def has_change_permission(self, request, obj=None):  # pragma: no cover - audit entries are read-only
        return False
