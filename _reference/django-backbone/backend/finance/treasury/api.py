"""Treasury Command Centre dashboard (super-admin)."""
from django.http import JsonResponse

from backend.accounts.decorators import require_super_admin
from .models import (AllocationWallet, AllocationTransaction, ExpenseObligation,
                     current_period)
from . import analytics


@require_super_admin
def dashboard(request):
    period = request.GET.get('period') or current_period()
    fc = analytics.forecast(period)
    a = analytics.analytics_from_bookings()

    def wallets_of(cat):
        out = []
        for w in AllocationWallet.objects.filter(category=cat, is_active=True).order_by('priority'):
            t = w.target_cents()
            f = w.funded_this_period(period)
            out.append({'slug': w.slug, 'name': w.name, 'balance_cents': w.balance_cents,
                        'target_cents': t, 'funded_this_period_cents': f,
                        'progress': round(f / t, 3) if t else None})
        return out

    debit_orders = [{'vendor': o.vendor, 'wallet': o.wallet.slug, 'amount_cents': o.amount_cents,
                     'due_day': o.due_day,
                     'funded_cents': o.wallet.funded_this_period(period),
                     'covered': o.wallet.funded_this_period(period) >= o.amount_cents}
                    for o in ExpenseObligation.objects.filter(is_active=True).order_by('due_day', 'priority')]

    history = [{'reference': t.booking.reference if t.booking else None, 'wallet': t.wallet.slug,
                'amount_cents': t.amount_cents, 'kind': t.kind, 'period': t.period,
                'at': t.created_at.isoformat()}
               for t in AllocationTransaction.objects.select_related('wallet', 'booking')
               .exclude(amount_cents=0)[:40]]

    retained = AllocationWallet.objects.filter(slug='retained-earnings').first()
    health = round(min(1.0, fc['projected_coverage']) * 100)

    return JsonResponse({
        'period': period,
        'financial_health_score': health,
        'obligations': {
            'total_cents': fc['total_obligations_cents'],
            'funded_to_date_cents': fc['funded_to_date_cents'],
            'projected_month_end_cents': fc['projected_month_end_funding_cents'],
            'projected_coverage': fc['projected_coverage'],
            'projected_shortfall_cents': fc['projected_shortfall_cents'],
        },
        'expense_wallets': fc['wallets'],
        'reserves': wallets_of('reserve'),
        'capital': wallets_of('capital'),
        'cost_wallets': wallets_of('cost'),
        'upcoming_debit_orders': debit_orders,
        'allocation_history': history,
        'available_operating_cash_cents': retained.balance_cents if retained else 0,
        'revenue_analytics': a,
    })
