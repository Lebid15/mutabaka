from django.db import models


# ---- System Statistics (for admin dashboard) ----
class SystemStats(models.Model):
    """Proxy model to show system statistics in admin.
    
    This doesn't store any data - it's just a placeholder
    to register a custom admin view for system stats.
    """
    class Meta:
        managed = False  # No database table
        verbose_name = "إحصائيات النظام"
        verbose_name_plural = "إحصائيات النظام"
        app_label = 'stats'


class RevenueStats(models.Model):
    """Proxy model for revenue/profits statistics in admin."""
    class Meta:
        managed = False
        verbose_name = "الأرباح"
        verbose_name_plural = "الأرباح"
        app_label = 'stats'


