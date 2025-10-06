"""
Utility functions for calculating revenue and profits from subscriptions.
"""
from django.db.models import Sum, Count, Q
from django.utils import timezone
from subscriptions.models import UserSubscription, RenewalRequest, SubscriptionPlan
from django.contrib.auth import get_user_model

User = get_user_model()


def get_subscription_revenue_data():
    """
    Get revenue data for all users with subscriptions.
    
    Returns a list of dictionaries with:
    - user: User object
    - display_name: User's display name
    - plan_name: Current subscription plan name
    - renewal_date: Next renewal date (end_at)
    - days_remaining: Days until renewal
    - current_price: Current subscription price
    - total_paid: Total amount paid by this user across all renewals
    """
    revenue_data = []
    
    # Get all users who have or had subscriptions
    users_with_subs = UserSubscription.objects.select_related('user', 'plan').all()
    
    for subscription in users_with_subs:
        user = subscription.user
        
        # Get user's display name
        display_name = getattr(user, 'display_name', None) or getattr(user, 'username', 'N/A')
        
        # Calculate days remaining
        now = timezone.now()
        days_remaining = (subscription.end_at - now).days if subscription.end_at > now else 0
        
        # Get total paid by this user from all approved renewal requests
        total_paid = RenewalRequest.objects.filter(
            user=user,
            status=RenewalRequest.STATUS_APPROVED
        ).aggregate(total=Sum('amount'))['total'] or 0
        
        # Get current subscription price
        plan = subscription.plan
        # Estimate current price based on last renewal request or plan defaults
        last_renewal = RenewalRequest.objects.filter(
            user=user,
            status=RenewalRequest.STATUS_APPROVED
        ).order_by('-approved_at').first()
        
        if last_renewal and last_renewal.amount:
            current_price = float(last_renewal.amount)
        else:
            # Fallback to plan monthly price
            current_price = float(plan.monthly_price) if plan.monthly_price else 0
        
        revenue_data.append({
            'user': user,
            'display_name': display_name,
            'plan_name': plan.name or plan.code,
            'renewal_date': subscription.end_at,
            'days_remaining': max(0, days_remaining),
            'current_price': current_price,
            'total_paid': float(total_paid),
            'status': subscription.status,
        })
    
    return revenue_data


def get_revenue_summary():
    """
    Get summary statistics for revenue.
    
    Returns:
    - total_users: Number of users with subscriptions
    - total_revenue: Total revenue from all approved renewals
    - active_subscriptions: Number of currently active subscriptions
    - expired_subscriptions: Number of expired subscriptions
    """
    total_users = UserSubscription.objects.values('user').distinct().count()
    
    total_revenue = RenewalRequest.objects.filter(
        status=RenewalRequest.STATUS_APPROVED
    ).aggregate(total=Sum('amount'))['total'] or 0
    
    active_count = UserSubscription.objects.filter(
        status=UserSubscription.STATUS_ACTIVE
    ).count()
    
    expired_count = UserSubscription.objects.filter(
        status=UserSubscription.STATUS_EXPIRED
    ).count()
    
    return {
        'total_users': total_users,
        'total_revenue': float(total_revenue),
        'active_subscriptions': active_count,
        'expired_subscriptions': expired_count,
    }


def get_revenue_by_plan():
    """
    Get revenue breakdown by subscription plan.
    
    Returns list of dicts with plan_name and total_revenue.
    """
    plans_revenue = []
    
    for plan in SubscriptionPlan.objects.all():
        revenue = RenewalRequest.objects.filter(
            plan=plan,
            status=RenewalRequest.STATUS_APPROVED
        ).aggregate(total=Sum('amount'))['total'] or 0
        
        user_count = UserSubscription.objects.filter(plan=plan).count()
        
        plans_revenue.append({
            'plan_name': plan.name or plan.code,
            'total_revenue': float(revenue),
            'user_count': user_count,
        })
    
    return plans_revenue
