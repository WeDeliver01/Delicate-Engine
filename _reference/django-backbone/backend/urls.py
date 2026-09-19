import types
from django.contrib import admin
from django.db.models import Sum
from django.urls import path, include
from django.db.models.functions import TruncMonth
from datetime import datetime, timedelta
from rest_framework.routers import DefaultRouter
from backend.quotes.views import QuoteViewSet, estimate_price, rate_context
from backend.quotes.views import user_dashboard, settings_dashboard, settings_save, dashboard, download_quote_pdf
from backend.finance.urls import urlpatterns as finance_urls
from backend.scheduling.urls import urlpatterns as scheduling_urls
from backend.catalog.urls import urlpatterns as catalog_urls
from backend.tracking.urls import urlpatterns as tracking_urls
from backend.accounts.urls import urlpatterns as accounts_urls

# Patch the default admin site with a custom dashboard BEFORE urlpatterns are defined
# This is crucial - the patch must be applied before admin.site.urls is referenced
def _custom_index(self, request, extra_context=None):
    from django.shortcuts import render
    from django.db.models import Sum
    from django.db.models.functions import TruncMonth
    from datetime import datetime, timedelta
    from backend.quotes.models import Quote, Client

    quote_count = Quote.objects.count()
    total_revenue = Quote.objects.aggregate(total=Sum('revenue'))['total'] or 0
    total_distance = Quote.objects.aggregate(total=Sum('total_distance_km'))['total'] or 0 
    customer_count = Client.objects.count()

    # Revenue by month (last 12 months)
    now = datetime.now().date()
    months = []
    revenue_by_month = {}
    for i in range(11, -1, -1):
        d = (now.replace(day=1) - timedelta(days=i * 30)).replace(day=1)
        months.append(d.strftime('%b %Y'))
        revenue_by_month[d.strftime('%Y-%m')] = 0

    monthly = (
        Quote.objects
        .annotate(month=TruncMonth('created_at'))
        .values('month')
        .annotate(total=Sum('revenue'))
        .order_by('month')
    )
    for entry in monthly:
        key = entry['month'].strftime('%Y-%m')
        revenue_by_month[key] = float(entry['total'] or 0)

    chart_data = [revenue_by_month.get(m.replace(' ', ''), 0) for m in months]

    recent_quotes = Quote.objects.order_by('-created_at')[:5]

    context = {
        'quote_count': quote_count,
        'total_revenue': total_revenue,
        'total_distance': total_distance,
        'customer_count': customer_count,
        'chart_labels': months,
        'chart_data': chart_data,
        'recent_quotes': recent_quotes,
        'title': 'Dashboard',
    }
    if extra_context:
        context.update(extra_context)
    return render(request, 'admin/index.html', context)


# Apply the patch BEFORE admin.site.urls is used
admin.site.index = types.MethodType(_custom_index, admin.site)
admin.site.site_header = "Delicate Courier Admin"
admin.site.site_title = "Delicate Courier"
admin.site.index_title = "Bakery Logistics Dashboard"


router = DefaultRouter()
router.register(r'quotes', QuoteViewSet, basename='quote')

urlpatterns = [
    path('', dashboard, name='dashboard'),
    path('admin/', admin.site.urls),
    path('api/', include(router.urls)),
    path('api/quotes', QuoteViewSet.as_view({'post': 'create'})),
    path('api/estimate/', estimate_price, name='estimate_price'),
    path('api/rate-context/', rate_context, name='rate_context'),
    path('api/rate-context', rate_context),
    path('api/estimate', estimate_price),   # without trailing slash
    path('users/', user_dashboard, name='user_dashboard'),
    path('settings/', settings_dashboard, name='settings_dashboard'),
    path('settings/save/', settings_save, name='settings_save'),
    path('api/quotes/<int:quote_id>/pdf/', download_quote_pdf, name='quote_pdf'),
] + finance_urls + scheduling_urls + catalog_urls + tracking_urls + accounts_urls