from django.urls import path
from .views import MySubscriptionView, CreateRenewalView, PlansListView


urlpatterns = [
    path('me', MySubscriptionView.as_view(), name='subscriptions_me'),
    path('renew', CreateRenewalView.as_view(), name='subscriptions_renew'),
    path('plans', PlansListView.as_view(), name='subscriptions_plans'),
]
