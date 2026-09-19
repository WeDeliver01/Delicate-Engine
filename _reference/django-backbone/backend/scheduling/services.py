"""
Capacity operations. The consume path is concurrency-safe: the slot row is
locked with select_for_update before its count is read and incremented, so two
clients racing for the last space cannot both win.

These functions are designed to be called inside a surrounding transaction
(finance.charge_booking wraps the slot consume and the wallet debit in one
atomic block, so a booking either takes a space AND pays, or does neither).
"""
from datetime import date as date_cls, datetime, timedelta

from django.db import transaction
from django.utils import timezone

from .models import SlotPolicy, DeliverySlot, BlackoutDate


class SlotUnavailable(Exception):
    def __init__(self, reason='unavailable'):
        self.reason = reason
        super().__init__(reason)


def materialize_slot(d, window_key, policy=None) -> DeliverySlot | None:
    """Get or create the concrete slot for a date+window from the policy.
    Returns None if the window is not defined in the policy."""
    if isinstance(d, str):
        d = datetime.strptime(d, '%Y-%m-%d').date()
    policy = policy or SlotPolicy.get_active()
    w = policy.window(window_key)
    if w is None:
        return None
    slot, created = DeliverySlot.objects.get_or_create(
        date=d, window_key=window_key,
        defaults={'label': w.get('label', window_key),
                  'start_time': w['start'], 'end_time': w['end'],
                  'capacity': w.get('capacity', policy.default_capacity),
                  'status': 'open'})
    if created:
        slot.refresh_from_db()      # coerce the just-inserted string fields to date/time
    return slot


def lock_slot(d, window_key) -> DeliverySlot | None:
    """Materialize then re-fetch the slot under a row lock. Call inside atomic."""
    base = materialize_slot(d, window_key)
    if base is None:
        return None
    return DeliverySlot.objects.select_for_update().get(pk=base.pk)


def consume(slot: DeliverySlot, qty: int = 1):
    """Increment a locked slot's count and auto-close when full. Caller must hold
    the lock and have already confirmed is_bookable."""
    slot.booked_count += qty
    if slot.booked_count >= slot.capacity:
        slot.booked_count = min(slot.booked_count, slot.capacity)
        slot.status = 'closed_full'
    slot.save(update_fields=['booked_count', 'status', 'updated_at'])


@transaction.atomic
def release(slot_id: int, qty: int = 1):
    """Return capacity to a slot (booking reversal). Reopens an auto-closed slot
    if it now has room. A manually closed slot stays closed."""
    slot = DeliverySlot.objects.select_for_update().get(pk=slot_id)
    slot.booked_count = max(0, slot.booked_count - qty)
    if slot.status == 'closed_full' and slot.booked_count < slot.capacity:
        slot.status = 'open'
    slot.save(update_fields=['booked_count', 'status', 'updated_at'])
    return slot


@transaction.atomic
def set_slot_closed(d, window_key, closed: bool):
    """Super admin manual close / reopen."""
    slot = lock_slot(d, window_key)
    if slot is None:
        raise SlotUnavailable('no_such_window')
    if closed:
        slot.status = 'closed_manual'
    else:
        slot.status = 'closed_full' if slot.remaining <= 0 else 'open'
    slot.save(update_fields=['status', 'updated_at'])
    return slot


@transaction.atomic
def set_slot_capacity(d, window_key, capacity: int):
    """Super admin override of a single slot's capacity."""
    slot = lock_slot(d, window_key)
    if slot is None:
        raise SlotUnavailable('no_such_window')
    slot.capacity = max(0, capacity)
    if slot.status == 'closed_full' and slot.remaining > 0:
        slot.status = 'open'
    elif slot.remaining <= 0 and slot.status == 'open':
        slot.status = 'closed_full'
    slot.save(update_fields=['capacity', 'status', 'updated_at'])
    return slot


def get_availability(date_from: date_cls, date_to: date_cls, policy=None) -> list:
    """Client-facing availability across a date range. Materializes operating
    windows so clients see every slot and watch remaining counts fall."""
    policy = policy or SlotPolicy.get_active()
    now = timezone.now()
    blackouts = set(BlackoutDate.objects.filter(
        date__range=(date_from, date_to)).values_list('date', flat=True))
    out = []
    d = date_from
    while d <= date_to:
        if policy.operates_on(d):
            for w in policy.windows:
                slot = materialize_slot(d, w['key'], policy)
                bookable = slot.is_bookable(now) and d not in blackouts
                out.append({
                    'date': d.isoformat(),
                    'window_key': slot.window_key,
                    'label': slot.label,
                    'start': slot.start_time.strftime('%H:%M'),
                    'end': slot.end_time.strftime('%H:%M'),
                    'capacity': slot.capacity,
                    'booked': slot.booked_count,
                    'remaining': slot.remaining,
                    'bookable': bookable,
                    'closed_reason': '' if bookable else slot.closed_reason(now),
                })
        d += timedelta(days=1)
    return out
