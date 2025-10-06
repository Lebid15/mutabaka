from django.contrib import admin
from django.utils.html import format_html
from django.urls import reverse
from django import forms
from django.http import HttpRequest
from django.db import models
from ckeditor.widgets import CKEditorWidget
from .models import (
    ContactRelation,
    Conversation,
    Message,
    Transaction,
    PushSubscription,
    NotificationSetting,
    BrandingSetting,
    LoginPageSetting,
    LoginInstruction,
    PrivacyPolicy,
    ContactLink,
    TeamMember,
    ConversationMember,
)

@admin.register(ContactRelation)
class ContactRelationAdmin(admin.ModelAdmin):
    list_display = ("id", "owner", "contact", "created_at")
    search_fields = ("owner__username", "contact__username")
    list_select_related = ("owner", "contact")

class MessageInline(admin.TabularInline):
    """
    Quick-reply inline: show a single empty row to send a new text message as the admin.
    Existing messages are available via the Messages changelist, but this keeps the
    conversation page focused on quick replies.
    """
    model = Message
    extra = 1
    max_num = 1
    can_delete = False
    fields = ("body",)
    readonly_fields = ()
    show_change_link = False

@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("id", "user_a", "user_b", "last_message_preview", "last_activity_at")
    search_fields = ("user_a__username", "user_b__username")
    list_select_related = ("user_a", "user_b")
    inlines = [MessageInline]

    def last_message_preview(self, obj):
        return obj.last_message_preview[:40] if obj.last_message_preview else ""
    last_message_preview.short_description = "Last Msg"

    def save_formset(self, request, form, formset, change):
        # Auto-assign sender/type for quick-reply inline rows and skip empty bodies
        instances = formset.save(commit=False)
        for obj in instances:
            # Only handle Message inline instances
            if isinstance(obj, Message):
                body = (obj.body or "").strip()
                if not body:
                    # Skip saving empty quick-reply rows
                    continue
                if not getattr(obj, "sender_id", None):
                    obj.sender = request.user
                if not obj.type:
                    obj.type = "text"
                obj.save()
            else:
                obj.save()
        formset.save_m2m()


class PrivacyPolicyAdminForm(forms.ModelForm):
    content = forms.CharField(
        label="المحتوى",
        widget=CKEditorWidget(config_name="default"),
    )

    class Meta:
        model = PrivacyPolicy
        fields = "__all__"


class LoginInstructionInlineForm(forms.ModelForm):
    description = forms.CharField(
        label="الوصف",
        widget=CKEditorWidget(config_name="default"),
        required=True,
    )

    class Meta:
        model = LoginInstruction
        fields = "__all__"


class LoginInstructionInline(admin.StackedInline):
    model = LoginInstruction
    form = LoginInstructionInlineForm
    extra = 1
    fields = ("is_active", "display_order", "title", "description", "icon_hint")
    ordering = ("display_order", "id")
    show_change_link = True


class LoginPageSettingAdminForm(forms.ModelForm):
    hero_description = forms.CharField(
        label="وصف العنوان",
        widget=CKEditorWidget(config_name="default"),
        required=False,
    )
    footer_note = forms.CharField(
        label="نص التذييل",
        widget=CKEditorWidget(config_name="default"),
        required=False,
    )
    footer_secondary_note = forms.CharField(
        label="نص تذييل إضافي",
        widget=CKEditorWidget(config_name="default"),
        required=False,
    )

    class Meta:
        model = LoginPageSetting
        fields = "__all__"

@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("id", "conversation", "sender", "type", "short_body", "created_at")
    list_filter = ("type",)
    search_fields = ("body", "conversation__user_a__username", "conversation__user_b__username", "sender__username")
    list_select_related = ("conversation", "sender")

    def short_body(self, obj):
        return (obj.body or "")[:50]
    short_body.short_description = "Body"

@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ("id", "conversation", "from_user", "to_user", "direction", "amount", "currency", "created_at")
    search_fields = ("conversation__user_a__username", "conversation__user_b__username", "from_user__username", "to_user__username")
    list_filter = ("direction", "currency")
    list_select_related = ("conversation", "from_user", "to_user", "currency")

@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "endpoint", "created_at")
    search_fields = ("endpoint", "user__username")

@admin.register(NotificationSetting)
class NotificationSettingAdmin(admin.ModelAdmin):
    list_display = ("id", "active", "updated_at")
    list_filter = ("active",)


@admin.register(BrandingSetting)
class BrandingSettingAdmin(admin.ModelAdmin):
    list_display = ("id", "active", "updated_at", "logo_thumbnail")
    list_filter = ("active",)
    readonly_fields = ("logo_preview",)
    fields = ("active", "logo", "logo_preview")

    def logo_thumbnail(self, obj):
        try:
            if obj.logo:
                return format_html('<img src="{}" style="max-height:40px;" />', obj.logo.url)
        except Exception:
            pass
        return "-"
    logo_thumbnail.short_description = "Logo"

    def logo_preview(self, obj):
        try:
            if obj.logo:
                return format_html('<img src="{}" style="max-height:160px;" />', obj.logo.url)
        except Exception:
            pass
        return "-"
    logo_preview.short_description = "Preview"


@admin.register(LoginPageSetting)
class LoginPageSettingAdmin(admin.ModelAdmin):
    form = LoginPageSettingAdminForm
    inlines = [LoginInstructionInline]
    list_display = ("hero_title", "is_active", "updated_at")
    list_editable = ("is_active",)
    list_filter = ("is_active",)
    search_fields = ("hero_title", "hero_description", "footer_note")
    ordering = ("-updated_at", "-id")
    fieldsets = (
        ("الحالة", {"fields": ("is_active",)}),
        ("الشعار والصور", {"fields": ("login_logo",)}),
        ("العنوان", {"fields": ("hero_title", "hero_description", "instructions_title")}),
        ("خيارات الواجهة", {"fields": ("stay_logged_in_label", "stay_logged_in_hint", "alternate_login_label", "alternate_login_url")}),
        ("التذييل", {"fields": ("footer_links_label", "footer_note", "footer_secondary_note", "footer_brand_name", "footer_year_override")}),
    )

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs.prefetch_related('instructions')


@admin.register(PrivacyPolicy)
class PrivacyPolicyAdmin(admin.ModelAdmin):
    form = PrivacyPolicyAdminForm
    list_display = ("title", "document_type", "is_active", "display_order", "updated_at")
    list_editable = ("is_active", "display_order")
    search_fields = ("title", "content")
    list_filter = ("document_type", "is_active")
    ordering = ("document_type", "display_order", "-updated_at")
    fieldsets = (
        (None, {"fields": ("document_type", "title", "content", "is_active", "display_order"), "description": "قم بتحرير النص باستخدام أدوات التنسيق المتقدمة."}),
    )


@admin.register(ContactLink)
class ContactLinkAdmin(admin.ModelAdmin):
    list_display = ("icon", "display_label", "value", "is_active", "display_order", "updated_at")
    list_editable = ("is_active", "display_order")
    list_filter = ("icon", "is_active")
    search_fields = ("label", "value")
    ordering = ("display_order", "icon")
    fieldsets = (
        ("معلومات التواصل", {
            "fields": ("icon", "label", "value", "is_active", "display_order"),
        }),
    )

    def display_label(self, obj):
        return obj.label or dict(obj.ICON_CHOICES).get(obj.icon, obj.icon)
    display_label.short_description = "التسمية"

@admin.register(TeamMember)
class TeamMemberAdmin(admin.ModelAdmin):
    list_display = ("id", "owner", "username", "display_name", "phone", "is_active", "created_at")
    search_fields = ("owner__username", "username", "display_name", "phone")

@admin.register(ConversationMember)
class ConversationMemberAdmin(admin.ModelAdmin):
    list_display = ("id", "conversation", "member_display", "added_by", "created_at")
    search_fields = ("conversation__id", "member_user__username", "member_team__username", "added_by__username")

    def member_display(self, obj):
        try:
            if obj.member_user_id:
                return getattr(obj.member_user, 'username', obj.member_user_id)
            if obj.member_team_id:
                return getattr(obj.member_team, 'username', obj.member_team_id)
        except Exception:
            return "N/A"
    member_display.short_description = "Member"
