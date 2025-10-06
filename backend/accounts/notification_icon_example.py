"""
مثال على استخدام أيقونة الإشعارات في FCM
Example of using notification icon in FCM notifications
"""

from accounts.site_settings import get_notification_icon_url


def build_fcm_notification_payload(title: str, body: str, user_token: str, **kwargs) -> dict:
    """
    بناء payload للإشعار مع إضافة الأيقونة المخصصة تلقائياً
    Build FCM notification payload with custom icon automatically included
    
    Args:
        title: عنوان الإشعار
        body: نص الإشعار
        user_token: FCM token للمستخدم
        **kwargs: بيانات إضافية
    
    Returns:
        dict: FCM payload جاهز للإرسال
    """
    # الحصول على رابط أيقونة الإشعارات من الإعدادات
    icon_url = get_notification_icon_url()
    
    # بناء الـ payload الأساسي
    message = {
        'notification': {
            'title': title,
            'body': body,
        },
        'data': kwargs.get('data', {}),
        'token': user_token,
    }
    
    # إضافة الأيقونة إذا كانت متوفرة
    if icon_url:
        # للأندرويد
        message['android'] = {
            'notification': {
                'icon': icon_url,  # الأيقونة الكبيرة
                'sound': 'default',
                'channel_id': 'mutabaka-messages',
            }
        }
        
        # يمكن أيضاً إضافتها للـ notification العام
        message['notification']['icon'] = icon_url
    else:
        # إعدادات افتراضية بدون أيقونة مخصصة
        message['android'] = {
            'notification': {
                'sound': 'default',
                'channel_id': 'mutabaka-messages',
            }
        }
    
    # إعدادات iOS
    message['apns'] = {
        'payload': {
            'aps': {
                'sound': 'default',
                'badge': kwargs.get('badge', 1),
            }
        }
    }
    
    return message


def send_conversation_notification(
    user,
    sender_name: str,
    message_preview: str,
    conversation_id: int,
    unread_count: int = 1
) -> None:
    """
    إرسال إشعار محادثة جديدة
    Send new conversation message notification
    
    Args:
        user: المستخدم المستلم
        sender_name: اسم المرسل
        message_preview: معاينة الرسالة
        conversation_id: معرف المحادثة
        unread_count: عدد الرسائل غير المقروءة
    """
    from firebase_admin import messaging
    
    title = f"رسالة جديدة من {sender_name}"
    
    payload = build_fcm_notification_payload(
        title=title,
        body=message_preview,
        user_token=user.push_token,
        data={
            'type': 'new_message',
            'conversation_id': str(conversation_id),
            'sender_name': sender_name,
        },
        badge=unread_count,
    )
    
    try:
        # إرسال الإشعار
        response = messaging.send(payload)
        print(f"✅ Notification sent successfully: {response}")
    except Exception as e:
        print(f"❌ Failed to send notification: {e}")


def send_bulk_notifications(users_tokens: list[str], title: str, body: str) -> dict:
    """
    إرسال إشعارات جماعية لعدة مستخدمين
    Send bulk notifications to multiple users
    
    Args:
        users_tokens: قائمة FCM tokens
        title: عنوان الإشعار
        body: نص الإشعار
    
    Returns:
        dict: نتائج الإرسال
    """
    from firebase_admin import messaging
    
    # الحصول على الأيقونة مرة واحدة
    icon_url = get_notification_icon_url()
    
    messages = []
    for token in users_tokens:
        message_config = {
            'notification': messaging.Notification(
                title=title,
                body=body,
                image=icon_url if icon_url else None,
            ),
            'token': token,
        }
        
        if icon_url:
            message_config['android'] = messaging.AndroidConfig(
                notification=messaging.AndroidNotification(
                    icon=icon_url,
                    sound='default',
                    channel_id='mutabaka-messages',
                )
            )
        
        messages.append(messaging.Message(**message_config))
    
    # إرسال دفعة واحدة (أكثر كفاءة)
    try:
        response = messaging.send_all(messages)
        return {
            'success_count': response.success_count,
            'failure_count': response.failure_count,
            'responses': response.responses,
        }
    except Exception as e:
        print(f"❌ Bulk notification failed: {e}")
        return {'error': str(e)}


# مثال على الاستخدام المباشر
def example_usage():
    """مثال على الاستخدام"""
    from accounts.models import CustomUser
    from accounts.site_settings import get_notification_icon_url
    
    # الحصول على المستخدم
    user = CustomUser.objects.get(username='example_user')
    
    # التحقق من وجود أيقونة
    icon_url = get_notification_icon_url()
    if icon_url:
        print(f"✅ سيتم استخدام الأيقونة: {icon_url}")
    else:
        print("⚠️ لا توجد أيقونة مخصصة، سيتم استخدام الأيقونة الافتراضية")
    
    # إرسال إشعار
    if user.devices.filter(status='active').exists():
        device = user.devices.filter(status='active').first()
        if device.push_token:
            send_conversation_notification(
                user=user,
                sender_name='أحمد',
                message_preview='مرحباً! كيف حالك؟',
                conversation_id=123,
                unread_count=5,
            )


if __name__ == '__main__':
    # لاختبار الكود
    example_usage()
