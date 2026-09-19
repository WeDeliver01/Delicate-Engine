"""
The allocation engine. Runs after a booking is charged: derives fuel + driver
cost, computes contribution margin, and allocates that margin (never gross
revenue) across fixed obligations by remaining need and due-date urgency, then
cascades any surplus to reserves and finally retained earnings.

Properties: transactional, idempotent (keyed on the booking reference),
reversible, and event-driven (emits through the existing outbox).
"""
import datetime as dt

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .. import events
from .models import (AllocationWallet, AllocationTransaction, current_period)

FUEL_SLUG = 'cost-fuel'
DRIVER_SLUG = 'cost-driver'
RETAINED_SLUG = 'retained-earnings'


def _cfg(name, default):
    return getattr(settings, name, default)


def compute_costs(revenue_cents):
    """Fuel and driver cost as configurable shares of revenue (operational inputs
    from the fleet economics work, not allocation percentages). Contribution
    margin is what remains."""
    fuel_pct = float(_cfg('TREASURY_FUEL_PCT', 0.14))
    driver_pct = float(_cfg('TREASURY_DRIVER_PCT', 0.32))
    fuel = int(round(revenue_cents * fuel_pct))
    driver = int(round(revenue_cents * driver_pct))
    cm = revenue_cents - fuel - driver
    return {'fuel_cents': fuel, 'driver_cents': driver, 'contribution_margin_cents': max(0, cm)}


def _urgency(due_day, today):
    """A weight >= 1 that rises as an obligation's debit-order date approaches, so
    near-term obligations are funded faster. Time matters."""
    window = int(_cfg('TREASURY_URGENCY_WINDOW_DAYS', 10))
    boost = float(_cfg('TREASURY_URGENCY_BOOST', 1.5))
    y, m = today.year, today.month
    try:
        due = dt.date(y, m, min(due_day, 28))
    except ValueError:
        due = dt.date(y, m, 28)
    if due < today:
        nm = dt.date(y + (m // 12), (m % 12) + 1, 1)
        due = dt.date(nm.year, nm.month, min(due_day, 28))
    days_until = (due - today).days
    if days_until >= window:
        return 1.0
    return 1.0 + (window - days_until) / window * boost


def _capped_proportional(amount, items):
    """Allocate `amount` (cents) across items=[(key, need, weight)] proportional to
    weight, capping each at need (need=None is unbounded). Returns ({key:cents},
    leftover). Bounded loop; remainder from integer rounding falls to leftover."""
    alloc = {k: 0 for k, _, _ in items}
    remaining = amount
    for _ in range(40):
        pool = [(k, n, w) for k, n, w in items
                if w > 0 and (n is None or n - alloc[k] > 0)]
        tw = sum(w for _, _, w in pool)
        if remaining <= 0 or not pool or tw <= 0:
            break
        progressed = False
        for k, n, w in pool:
            share = remaining * w // tw
            if share <= 0:
                continue
            room = remaining if n is None else min(n - alloc[k], remaining)
            give = min(share, room)
            if give > 0:
                alloc[k] += give
                remaining -= give
                progressed = True
        if not progressed:
            # hand the rounding remainder to the heaviest-weight pool member
            k = max(pool, key=lambda t: t[2])[0]
            alloc[k] += remaining
            remaining = 0
            break
    return alloc, remaining


def _post(wallet, amount, kind, booking, period, key, desc=''):
    AllocationTransaction.objects.create(
        booking=booking, wallet=wallet, amount_cents=amount, kind=kind,
        period=period, idempotency_key=key, description=desc)
    wallet.balance_cents += amount
    wallet.save(update_fields=['balance_cents', 'updated_at'])


def already_allocated(booking):
    return AllocationTransaction.objects.filter(
        idempotency_key=f"alloc:{booking.reference}:cm").exists()


@transaction.atomic
def allocate_for_booking(booking, today=None):
    """Idempotently allocate one booking's contribution margin. Safe to re-run."""
    today = today or timezone.now().date()
    period = today.strftime('%Y-%m')
    base = f"alloc:{booking.reference}"
    if already_allocated(booking):
        return {'status': 'already_allocated', 'reference': booking.reference}
    # Until the treasury wallets are seeded, allocation is a clean no-op so the
    # charge path and outbox keep working. Backfill once seeded.
    if not AllocationWallet.objects.exists():
        return {'status': 'no_treasury_wallets', 'reference': booking.reference}

    costs = compute_costs(booking.price_cents)
    cm = costs['contribution_margin_cents']

    fuel_w = AllocationWallet.objects.select_for_update().filter(slug=FUEL_SLUG).first()
    driver_w = AllocationWallet.objects.select_for_update().filter(slug=DRIVER_SLUG).first()
    if fuel_w:
        _post(fuel_w, costs['fuel_cents'], 'cost_fuel', booking, period,
              f"{base}:fuel", f"Fuel cost {booking.reference}")
    if driver_w:
        _post(driver_w, costs['driver_cents'], 'cost_driver', booking, period,
              f"{base}:driver", f"Driver payout {booking.reference}")

    # Marker txn so re-runs are detected even if CM is zero.
    AllocationTransaction.objects.create(
        booking=booking, wallet=(fuel_w or driver_w), amount_cents=0, kind='allocation',
        period=period, idempotency_key=f"{base}:cm", source='contribution_margin',
        description=f"Contribution margin {booking.reference} = {cm}c")

    moved = {}
    if cm > 0:
        # Phase 1: fixed obligations, by remaining need x due-date urgency.
        exp = list(AllocationWallet.objects.select_for_update()
                   .filter(category='operating_expense', is_active=True))
        items = []
        for w in exp:
            need = w.remaining_need(period)
            if need and need > 0:
                ob = getattr(w, 'obligation', None)
                urg = _urgency(ob.due_day, today) if ob else 1.0
                items.append((w.slug, need, need * urg))
        alloc, leftover = _capped_proportional(cm, items)
        byslug = {w.slug: w for w in exp}
        for slug, amt in alloc.items():
            if amt > 0:
                _post(byslug[slug], amt, 'allocation', booking, period,
                      f"{base}:exp:{slug}", f"Obligation funding {booking.reference}")
                moved[slug] = amt

        # Phase 2: surplus cascades to reserves (priority, capped), then retained.
        if leftover > 0:
            reserves = AllocationWallet.objects.select_for_update().filter(
                category='reserve', is_active=True).order_by('priority')
            for w in reserves:
                if leftover <= 0:
                    break
                need = w.remaining_need(period)
                give = leftover if need is None else min(need, leftover)
                if give > 0:
                    _post(w, give, 'overflow', booking, period,
                          f"{base}:res:{w.slug}", f"Reserve funding {booking.reference}")
                    moved[w.slug] = give
                    leftover -= give
        if leftover > 0:
            sink = AllocationWallet.objects.select_for_update().filter(slug=RETAINED_SLUG).first()
            if sink:
                _post(sink, leftover, 'overflow', booking, period,
                      f"{base}:retained", f"Retained earnings {booking.reference}")
                moved[sink.slug] = leftover
                leftover = 0

    events.enqueue_engine_event('treasury.allocated',
                   f"treasury:allocated:{booking.reference}",
                   {'booking_reference': booking.reference, 'period': period,
                    'revenue_cents': booking.price_cents,
                    'fuel_cents': costs['fuel_cents'], 'driver_cents': costs['driver_cents'],
                    'contribution_margin_cents': cm, 'allocated': moved})
    return {'status': 'allocated', 'reference': booking.reference,
            'contribution_margin_cents': cm, 'allocated': moved}


@transaction.atomic
def reverse_allocations(booking):
    """Reverse every allocation for a booking with signed-opposite mirror entries.
    Idempotent: already-reversed rows are skipped."""
    txns = list(AllocationTransaction.objects.select_for_update()
                .filter(booking=booking, reversed=False).exclude(kind='reversal'))
    reversed_count = 0
    for t in txns:
        if t.amount_cents != 0:
            w = AllocationWallet.objects.select_for_update().get(pk=t.wallet_id)
            AllocationTransaction.objects.create(
                booking=booking, wallet=w, amount_cents=-t.amount_cents, kind='reversal',
                period=t.period, idempotency_key=f"rev:{t.idempotency_key}",
                description=f"Reversal of {t.idempotency_key}")
            w.balance_cents -= t.amount_cents
            w.save(update_fields=['balance_cents', 'updated_at'])
        t.reversed = True
        t.save(update_fields=['reversed'])
        reversed_count += 1
    return {'status': 'reversed', 'reference': booking.reference, 'entries': reversed_count}
