"""
Custom admin views for Delicate Courier Admin.
"""
from django.contrib.admin.views.decorators import staff_member_required
from django.utils.decorators import method_decorator
from django.views.generic import TemplateView
from django.db.models import Sum, Count
from .models import Quote, Customer


@method_decorator(staff_member_required, name='dispatch')
class DelicateIndexView(TemplateView):
    """Custom admin index with business statistics."""
    template_name = 'admin/index.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        quote_count = Quote.objects.count()
        total_revenue = Quote.objects.aggregate(total=Sum('revenue'))['total'] or 0
        total_distance = Quote.objects.aggregate(total=Sum('total_distance_km'))['total'] or 0
        customer_count = Customer.objects.count()

        context.update({
            'quote_count': quote_count,
            'total_revenue': total_revenue,
            'total_distance': total_distance,
            'customer_count': customer_count,
            'title': 'Dashboard',
        })
        return context
