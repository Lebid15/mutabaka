from django.contrib import admin
from django.utils.html import format_html
from django.shortcuts import render
from .models import SystemStats, RevenueStats
from .system_utils import get_all_stats
from .revenue_utils import get_subscription_revenue_data, get_revenue_summary, get_revenue_by_plan


@admin.register(SystemStats)
class SystemStatsAdmin(admin.ModelAdmin):
    """Custom admin view to display system statistics."""
    
    def has_add_permission(self, request):
        return False
    
    def has_delete_permission(self, request, obj=None):
        return False
    
    def has_change_permission(self, request, obj=None):
        return False
    
    def changelist_view(self, request, extra_context=None):
        """Override to show custom statistics page."""
        stats = get_all_stats()
        
        context = {
            **self.admin_site.each_context(request),
            'title': 'إحصائيات النظام',
            'stats': stats,
            'opts': self.model._meta,
            'has_view_permission': True,
        }
        
        return render(
            request,
            'admin/stats/system_stats.html',
            context
        )


@admin.register(RevenueStats)
class RevenueStatsAdmin(admin.ModelAdmin):
    """Custom admin view for revenue/profits with detailed table."""
    
    def has_add_permission(self, request):
        return False
    
    def has_delete_permission(self, request, obj=None):
        return False
    
    def has_change_permission(self, request, obj=None):
        return False
    
    def changelist_view(self, request, extra_context=None):
        revenue_data = get_subscription_revenue_data()
        summary = get_revenue_summary()
        by_plan = get_revenue_by_plan()
        
        context = {
            **self.admin_site.each_context(request),
            'title': 'الأرباح',
            'revenue_data': revenue_data,
            'summary': summary,
            'by_plan': by_plan,
            'opts': self.model._meta,
            'has_view_permission': True,
        }
        
        return render(
            request,
            'admin/stats/revenue_stats.html',
            context
        )

