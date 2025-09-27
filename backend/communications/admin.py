from django.contrib import admin
from django.utils.html import format_html
from django.urls import reverse
from django import forms
from django.http import HttpRequest
from django.db import models
from .models import ContactRelation, Conversation, ConversationInbox, Message, Transaction, PushSubscription, NotificationSetting, BrandingSetting, ContactLink, TeamMember, ConversationMember

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


class QuickReplyForm(forms.Form):
    body = forms.CharField(label="Message", widget=forms.Textarea(attrs={"rows": 3}), required=True)


@admin.register(ConversationInbox)
class ConversationInboxAdmin(admin.ModelAdmin):
    """Dedicated admin inbox for staff:
    - Lists only conversations where the current user participates (user_a or user_b)
    - Shows latest preview/time and the other username
    - Provides a quick link to open the full conversation page
    """
    list_display = ("id", "other_party", "last_message_preview", "last_activity_at", "open")
    search_fields = ("user_a__username", "user_b__username")
    list_select_related = ("user_a", "user_b")
    ordering = ("-last_activity_at",)
    actions = ["reply_quick"]

    def get_queryset(self, request: HttpRequest):
        qs = super().get_queryset(request)
        # Limit to conversations where current staff user is either user_a or user_b
        return qs.filter(models.Q(user_a=request.user) | models.Q(user_b=request.user))

    def other_party(self, obj):
        request = getattr(self, "_request", None)
        # Fallback: pick the other user relative to request.user if available
        if request and hasattr(request, "user"):
            me = request.user
            other = obj.user_b if obj.user_a_id == me.id else obj.user_a
        else:
            other = obj.user_b or obj.user_a
        return getattr(other, "username", str(other))
    other_party.short_description = "User"

    def open(self, obj):
        url = reverse("admin:communications_conversation_change", args=[obj.id])
        return format_html('<a class="button" href="{}">Open</a>', url)
    open.short_description = "Open"

    def changelist_view(self, request, extra_context=None):
        # store request on self so other_party can access current user
        self._request = request
        return super().changelist_view(request, extra_context)

    @admin.action(description="Reply (quick)")
    def reply_quick(self, request, queryset):
        # Minimal quick-reply: for each selected conversation, create a message with the same body
        form = None
        if "apply" in request.POST:
            form = QuickReplyForm(request.POST)
            if form.is_valid():
                body = form.cleaned_data["body"].strip()
                if body:
                    count = 0
                    for conv in queryset:
                        Message.objects.create(conversation=conv, sender=request.user, type="text", body=body)
                        count += 1
                    self.message_user(request, f"تم إرسال الرد إلى {count} محادثة")
                    return
        if not form:
            form = QuickReplyForm()
        from django.shortcuts import render
        return render(request, "admin/communications/quick_reply.html", context={
            "conversations": queryset,
            "form": form,
            "title": "Reply to selected conversations",
            "opts": self.model._meta,
        })

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
            pass
        return "-"
    member_display.short_description = "Member"
