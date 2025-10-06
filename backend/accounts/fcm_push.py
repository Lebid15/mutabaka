"""
Firebase Cloud Messaging (FCM) Push Notifications using Firebase Admin SDK
This module uses FCM API V1 instead of the legacy API
"""

import os
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional

import firebase_admin
from firebase_admin import credentials, messaging
from django.conf import settings

logger = logging.getLogger(__name__)

# Initialize Firebase Admin SDK
_firebase_app = None

def _initialize_firebase():
    """Initialize Firebase Admin SDK with service account"""
    global _firebase_app
    
    if _firebase_app is not None:
        return _firebase_app
    
    try:
        # Try to get service account file path from settings or environment
        service_account_path = getattr(
            settings, 
            'FIREBASE_SERVICE_ACCOUNT_PATH', 
            os.getenv('FIREBASE_SERVICE_ACCOUNT_PATH')
        )
        
        if not service_account_path:
            # Default path: backend/firebase-service-account.json
            base_dir = Path(__file__).resolve().parent.parent
            service_account_path = base_dir / 'firebase-service-account.json'
        
        if not os.path.exists(service_account_path):
            logger.error(f"Firebase service account file not found: {service_account_path}")
            return None
        
        cred = credentials.Certificate(str(service_account_path))
        _firebase_app = firebase_admin.initialize_app(cred)
        
        logger.info("✅ Firebase Admin SDK initialized successfully")
        return _firebase_app
        
    except Exception as e:
        logger.exception(f"❌ Failed to initialize Firebase Admin SDK: {e}")
        return None


def send_fcm_notifications(tokens: List[str], title: str, body: str, data: Optional[Dict[str, Any]] = None, badge: Optional[int] = None) -> Dict[str, Any]:
    """
    Send push notifications using Firebase Cloud Messaging API V1
    
    Args:
        tokens: List of FCM/Expo push tokens
        title: Notification title
        body: Notification body
        data: Optional custom data payload
        badge: Optional badge count for app icon
    
    Returns:
        Dict with success and failure counts
    """
    logger.info(f"🔥 send_fcm_notifications called with {len(tokens) if tokens else 0} tokens")
    if not tokens:
        logger.warning("⚠️ No tokens provided to send_fcm_notifications")
        return {'success': 0, 'failure': 0, 'errors': []}
    
    # Initialize Firebase if needed
    if _initialize_firebase() is None:
        logger.error("Cannot send notifications: Firebase not initialized")
        return {'success': 0, 'failure': len(tokens), 'errors': ['Firebase not initialized']}
    
    results = {
        'success': 0,
        'failure': 0,
        'errors': [],
        'invalid_tokens': []
    }
    
    # Convert data dict to strings (FCM requires all values to be strings)
    string_data = {}
    if data:
        for key, value in data.items():
            string_data[key] = str(value)
    
    # Send notifications
    for token in tokens:
        try:
            # Create notification message
            message = messaging.Message(
                notification=messaging.Notification(
                    title=title,
                    body=body,
                ),
                data=string_data,
                token=token,
                android=messaging.AndroidConfig(
                    priority='high',
                    notification=messaging.AndroidNotification(
                        sound='default',
                        priority='high',
                        notification_count=badge if badge is not None else 0,
                        channel_id='mutabaka-messages-v2',
                    ),
                ),
                apns=messaging.APNSConfig(
                    payload=messaging.APNSPayload(
                        aps=messaging.Aps(
                            sound='default',
                            badge=badge if badge is not None else 0,
                        ),
                    ),
                ),
            )
            
            # Send message
            response = messaging.send(message)
            results['success'] += 1
            logger.info(f"✅ Notification sent successfully: {response}")
            
        except messaging.UnregisteredError:
            logger.warning(f"⚠️ Invalid token (unregistered): {token}")
            results['failure'] += 1
            results['invalid_tokens'].append(token)
            
        except Exception as e:
            logger.error(f"❌ Failed to send notification to {token}: {e}")
            results['failure'] += 1
            results['errors'].append(str(e))
    
    return results


def send_fcm_multicast(tokens: List[str], title: str, body: str, data: Optional[Dict[str, Any]] = None, badge: Optional[int] = None) -> Dict[str, Any]:
    """
    Send push notifications to multiple devices (sends individually)
    
    Args:
        tokens: List of FCM/Expo push tokens
        title: Notification title
        body: Notification body
        data: Optional custom data payload
        badge: Optional badge count for app icon
    
    Returns:
        Dict with success and failure counts
    """
    logger.info(f"🔥 send_fcm_multicast called with {len(tokens) if tokens else 0} tokens, badge={badge}")
    
    # Use the individual send method instead
    return send_fcm_notifications(tokens, title, body, data, badge)
