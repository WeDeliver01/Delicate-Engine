"""
Domain operations. Every function here is atomic and event-emitting:

    with transaction.atomic():
        mutate wallet + append ledger entry      (local durable state)
        write outbox message(s)                   (the push, same transaction)

The booking gate lives here too. The only system that knows the real price at
booking time is this side, so the gate is enforced here, against the local
wallet balance, before any charge or dispatch.
"""
import secrets
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from backend.quotes.models import Client
from backend.scheduling import services as sched
from backend.scheduling.services import SlotUnavailable
from . import events
from .money import to_cents, to_rands
from .models import (Wallet, LedgerEntry, TopUp, Booking, Parcel,
                     BookingIdentifier, ShipLogicBillingTxn)


class InsufficientFunds(Exception):
    def __init__(self, needed_cents, available_cents):
        self.needed_cents = needed_cents
        self.available_cents = available_cents
        super().__init__(f"needs {needed_cents}c, has {available_cents}c")


def get_or_create_wallet(client: Client) -> Wallet:
    wallet, _ = Wallet.objects.get_or_create(client=client)
    return wallet


def _post_entry(wallet: Wallet, kind: str, signed_amount_cents: int,
                reference: str, description: str = '') -> LedgerEntry:
    """Mutate the wallet balance and append one ledger entry. Caller holds the
    lock and the transaction."""
    wallet.balance_cents += signed_amount_cents
    wallet.save(update_fields=['balance_cents', 'updated_at'])
    return LedgerEntry.objects.create(
        wallet=wallet, kind=kind, amount_cents=signed_amount_cents,
        balance_after_cents=wallet.balance_cents,
        reference=reference, description=description,
    )


# ---------------------------------------------------------------------------
# Top-up: confirmed payment -> credit wallet -> push to engine + ShipLogic
# ---------------------------------------------------------------------------
@transaction.atomic
def confirm_topup(topup: TopUp) -> TopUp:
    """Idempotently apply a confirmed top-up. Safe to call twice (webhook
    redelivery): the second call sees status already confirmed and returns."""
    topup = TopUp.objects.select_for_update().get(pk=topup.pk)
    if topup.status == 'confirmed':
        return topup

    wallet = Wallet.objects.select_for_update().get_or_create(client=topup.client)[0]
    _post_entry(wallet, 'topup', topup.amount_cents,
                reference=f"topup:{topup.id}",
                description=f"Top-up via {topup.provider}")
    topup.status = 'confirmed'
    topup.confirmed_at = timezone.now()
    topup.save(update_fields=['status', 'confirmed_at'])

    # Push the balance movement to the financial engine.
    events.enqueue_engine_event(
        events.TOPUP_CONFIRMED, f"engine:topup:{topup.id}",
        {'client_id': topup.client_id, 'topup_id': topup.id,
         'amount_cents': topup.amount_cents, 'provider': topup.provider,
         'provider_reference': topup.provider_reference,
         'balance_after_cents': wallet.balance_cents},
    )
    # Reflect the payment on the client's ShipLogic statement (ShipLogic invoices).
    events.enqueue('shiplogic.billing', 'topup.payment',
                   f"sl:payment:topup:{topup.id}",
                   {'topup_id': topup.id, 'kind': 'payment',
                    'amount_cents': topup.amount_cents,
                    'client_id': topup.client_id})
    return topup


# ---------------------------------------------------------------------------
# Booking: gate -> charge wallet -> push to engine + queue ShipLogic dispatch
# ---------------------------------------------------------------------------
def charge_booking(client: Client, price_cents: int, reference: str,
                   quote=None, collection=None, delivery=None, parcels=None,
                   slot_date=None, slot_window=None) -> Booking:
    """Create and charge a booking. Enforces two gates under row locks: capacity
    (if a slot is requested) and wallet balance. On success the slot is consumed
    AND the wallet is debited in one transaction; if either gate fails, neither
    happens and a rejected booking is recorded with the reason.

    The rejected paths only take locks and read, so the transaction commits with
    no partial writes. The rejected booking is persisted afterwards."""
    existing = Booking.objects.filter(reference=reference).first()
    if existing:
        return existing  # idempotent on the booking reference

    outcome = None          # None = ok, 'slot' = no capacity, 'funds' = no balance
    locked_slot = None
    available_cents = 0
    with transaction.atomic():
        if slot_date and slot_window:
            locked_slot = sched.lock_slot(slot_date, slot_window)
            if locked_slot is None or not locked_slot.is_bookable():
                outcome = 'slot'

        if outcome is None:
            wallet = Wallet.objects.select_for_update().get_or_create(client=client)[0]
            available_cents = wallet.balance_cents
            if wallet.balance_cents < price_cents:
                outcome = 'funds'

        if outcome is None:
            if locked_slot is not None:
                sched.consume(locked_slot)        # take the space (auto-closes if full)
            booking = Booking.objects.create(
                client=client, quote=quote, price_cents=price_cents,
                status='charged', reference=reference, slot=locked_slot,
                collection=collection or {}, delivery=delivery or {}, parcels=parcels or [],
            )
            _post_entry(wallet, 'booking_charge', -price_cents,
                        reference=f"booking:{reference}",
                        description=f"Booking {reference}")
            events.enqueue_engine_event(
                events.BOOKING_CHARGED, f"engine:booking:{reference}",
                {'client_id': client.id, 'booking_reference': reference,
                 'price_cents': price_cents, 'quote_id': quote.id if quote else None,
                 'balance_after_cents': wallet.balance_cents})
            events.enqueue('shiplogic.shipment', 'booking.dispatch',
                           f"sl:shipment:{reference}",
                           {'booking_reference': reference})
            events.enqueue('treasury.allocate', 'booking.allocate',
                           f"treasury:allocate:{reference}",
                           {'booking_reference': reference})
            return booking
        # rejected: only locks + reads happened above, so this commits clean.

    status = ('rejected_slot_unavailable' if outcome == 'slot'
              else 'rejected_insufficient_funds')
    Booking.objects.create(
        client=client, quote=quote, price_cents=price_cents,
        status=status, reference=reference,
        collection=collection or {}, delivery=delivery or {}, parcels=parcels or [])
    if outcome == 'slot':
        reason = locked_slot.closed_reason() if locked_slot is not None else 'no_such_window'
        raise SlotUnavailable(reason)
    raise InsufficientFunds(price_cents, available_cents)


# ---------------------------------------------------------------------------
# Reversal: cancel/refund a booking -> credit wallet back -> unwind both sides
# ---------------------------------------------------------------------------
@transaction.atomic
def reverse_booking(reference: str, reason: str = '') -> Booking:
    booking = Booking.objects.select_for_update().get(reference=reference)
    if booking.status == 'reversed':
        return booking
    if booking.status == 'rejected_insufficient_funds':
        return booking  # never charged, nothing to reverse

    wallet = Wallet.objects.select_for_update().get(client=booking.client)
    _post_entry(wallet, 'booking_reversal', booking.price_cents,
                reference=f"booking:{reference}",
                description=f"Reversal of {reference}: {reason}"[:255])
    booking.status = 'reversed'
    booking.save(update_fields=['status', 'updated_at'])

    # Return the capacity to the slot so it can be rebooked.
    if booking.slot_id:
        sched.release(booking.slot_id)

    events.enqueue_engine_event(
        events.BOOKING_REVERSED, f"engine:reversal:{reference}",
        {'client_id': booking.client_id, 'booking_reference': reference,
         'amount_cents': booking.price_cents, 'reason': reason,
         'balance_after_cents': wallet.balance_cents},
    )
    # Reverse the ShipLogic charge with an admin-credit for the same booking.
    events.enqueue('shiplogic.billing', 'booking.reversal',
                   f"sl:credit:{reference}",
                   {'booking_reference': reference, 'kind': 'admin-credit',
                    'amount_cents': booking.price_cents})
    # Unwind the treasury allocation for this booking.
    from .treasury.services import reverse_allocations
    reverse_allocations(booking)
    return booking


# ---------------------------------------------------------------------------
# Quote -> Booking: the fast path. A quote needs no recipient contact; those
# become required only here, at the moment of booking.
# ---------------------------------------------------------------------------
class MissingContactDetails(Exception):
    def __init__(self, missing):
        self.missing = missing
        super().__init__(", ".join(missing))


REQUIRED_CONTACT = [
    ('collection', 'name'), ('collection', 'phone'),
    ('delivery', 'name'), ('delivery', 'phone'),
]


def _contact(block):
    return (block or {}).get('contact', {}) if isinstance(block, dict) else {}


def validate_contacts(collection, delivery):
    """Recipient and collection contact name + phone are required to finalise.
    This is the only step that demands them; the quote never did."""
    blocks = {'collection': _contact(collection), 'delivery': _contact(delivery)}
    missing = [f"{side}_{field}" for side, field in REQUIRED_CONTACT
               if not str(blocks[side].get(field, '')).strip()]
    return missing


def _liability_premium_cents(declared_value_cents, on):
    if not on or declared_value_cents <= 0:
        return 0
    pct = Decimal(str(getattr(settings, 'LIABILITY_RATE_PERCENT', '0')))
    return int((Decimal(declared_value_cents) * pct / 100).quantize(
        Decimal('1'), rounding=ROUND_HALF_UP))


def _new_reference():
    alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'   # no ambiguous chars
    for _ in range(20):
        ref = ''.join(secrets.choice(alphabet) for _ in range(6))
        if not Booking.objects.filter(reference=ref).exists():
            return ref
    return ''.join(secrets.choice(alphabet) for _ in range(8))


def rate_breakdown(quote, parcels=None):
    """Split a quote's price into base + fuel levy for display, and roll up
    actual / volumetric / charged weight from parcels."""
    total = to_cents(quote.revenue)
    fuel_pct = Decimal('0')
    if getattr(quote, 'rate_card_id', None) and quote.rate_card:
        fuel_pct = quote.rate_card.fuel_surcharge_percent or Decimal('0')
    base = int((Decimal(total) / (1 + fuel_pct / 100)).quantize(
        Decimal('1'), rounding=ROUND_HALF_UP)) if fuel_pct else total
    actual = vol = Decimal('0')
    for p in (parcels or []):
        l = Decimal(str(p.get('length_cm', 0))); w = Decimal(str(p.get('width_cm', 0)))
        h = Decimal(str(p.get('height_cm', 0))); kg = Decimal(str(p.get('weight_kg', 0)))
        actual += kg
        vol += (l * w * h) / Decimal('5000')
    charged = max(actual, vol)
    return {'total_cents': total, 'base_cents': base, 'fuel_levy_cents': total - base,
            'actual_weight_kg': str(actual), 'volumetric_weight_kg': str(vol.quantize(Decimal('0.01'))),
            'charged_weight_kg': str(charged.quantize(Decimal('0.01')))}


def _resolve_catalog(parcel):
    """Resolve package type / category by id or name, returning model instances."""
    from backend.catalog.models import PackageType, ParcelCategory
    pkg = cat = None
    if parcel.get('package_type_id'):
        pkg = PackageType.objects.filter(pk=parcel['package_type_id']).first()
    elif parcel.get('package_type'):
        pkg = PackageType.objects.filter(name=parcel['package_type']).first()
    if parcel.get('parcel_category_id'):
        cat = ParcelCategory.objects.filter(pk=parcel['parcel_category_id']).first()
    elif parcel.get('parcel_category'):
        cat = ParcelCategory.objects.filter(name=parcel['parcel_category']).first()
    return pkg, cat


def book_from_quote(client, quote, collection, delivery, parcels,
                    slot_date=None, slot_window=None, liability_cover=False,
                    declared_value_cents=0, customer_reference='', custom_tracking_ref=''):
    """Convert an accepted quote into a charged booking. Contacts are required
    here. Price = quote revenue + any liability premium. Runs the slot and wallet
    gates (via charge_booking), then attaches parcels and indexes identifiers."""
    missing = validate_contacts(collection, delivery)
    if missing:
        raise MissingContactDetails(missing)

    price_cents = to_cents(quote.revenue) + _liability_premium_cents(
        declared_value_cents, liability_cover)
    reference = _new_reference()

    booking = charge_booking(
        client=client, price_cents=price_cents, reference=reference, quote=quote,
        collection=collection, delivery=delivery, parcels=parcels,
        slot_date=slot_date, slot_window=slot_window)

    # booking is 'charged'. Finalise the additive details in one transaction.
    with transaction.atomic():
        booking.liability_cover = bool(liability_cover)
        booking.declared_value_cents = declared_value_cents or 0
        booking.customer_reference = customer_reference or ''
        booking.custom_tracking_ref = custom_tracking_ref or ''
        booking.save(update_fields=['liability_cover', 'declared_value_cents',
                                    'customer_reference', 'custom_tracking_ref', 'updated_at'])
        booking.attach_identifier('reference', reference)
        if customer_reference:
            booking.attach_identifier('customer_ref', customer_reference)
        if custom_tracking_ref:
            booking.attach_identifier('custom_tracking_ref', custom_tracking_ref)
        for i, p in enumerate(parcels or [], start=1):
            pkg, cat = _resolve_catalog(p)
            parcel = Parcel.objects.create(
                booking=booking, index=i, package_type=pkg, parcel_category=cat,
                length_cm=p.get('length_cm', 0) or 0, width_cm=p.get('width_cm', 0) or 0,
                height_cm=p.get('height_cm', 0) or 0, weight_kg=p.get('weight_kg', 0) or 0,
                alt_tracking_ref=p.get('alt_tracking_ref', '') or '',
                description=p.get('description', '') or '')
            if parcel.alt_tracking_ref:
                booking.attach_identifier('alt_tracking_ref', parcel.alt_tracking_ref)
    # Project into the unified shipment view so it shows in the dashboard at once.
    from backend.tracking.services import project_booking
    project_booking(booking)
    return booking
