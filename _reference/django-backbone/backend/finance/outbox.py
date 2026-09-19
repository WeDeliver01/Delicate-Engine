"""
The outbox dispatcher: delivers OutboxMessages to their destinations with
retries, backoff, soft-retry for unconfigured integrations, and dead-lettering.

Run it from the management command `dispatch_outbox` (once per tick from a
scheduler/worker, or with --loop). Each message is processed in its own
transaction so one failure never blocks the batch, and locking with
skip_locked makes it safe to run multiple workers concurrently.
"""
import logging
from datetime import timedelta

from django.db import transaction, connection
from django.utils import timezone

from . import events
from .clients import engine as engine_client
from .clients import shiplogic as shiplogic_client
from .models import (OutboxMessage, Booking, TopUp, ShipLogicShipment,
                     ShipLogicBillingTxn, Wallet)
from .money import format_rands

log = logging.getLogger('finance.outbox')

# Soft errors mean "not wired up yet" — retry forever, never dead-letter.
SOFT_ERRORS = (engine_client.EngineNotConfigured,
               shiplogic_client.ShipLogicNotConfigured)

SOFT_RETRY_SECONDS = 60
BACKOFF_BASE_SECONDS = 30
BACKOFF_CAP_SECONDS = 3600


def _backoff(attempts: int) -> int:
    return min(BACKOFF_BASE_SECONDS * (2 ** attempts), BACKOFF_CAP_SECONDS)


# ---------------------------------------------------------------------------
# Handlers (one per topic). Each raises on failure; the dispatcher decides
# whether that is a soft retry, a backoff retry, or a dead-letter.
# ---------------------------------------------------------------------------
def _handle_engine_event(msg: OutboxMessage):
    engine_client.push(msg.event_type, msg.payload, msg.idempotency_key)


def _handle_shiplogic_shipment(msg: OutboxMessage):
    booking = Booking.objects.get(reference=msg.payload['booking_reference'])
    wallet = Wallet.objects.get(client=booking.client)
    account_id = wallet.shiplogic_account_id
    if not account_id:
        # Identity not mapped yet — soft retry rather than fail the delivery.
        raise shiplogic_client.ShipLogicNotConfigured(
            f"no shiplogic_account_id for client {booking.client_id}")

    resp = shiplogic_client.create_shipment(
        account_id=account_id,
        collection=booking.collection, delivery=booking.delivery,
        parcels=booking.parcels or [{'weight_kg': 1}],
        customer_reference=booking.customer_reference,
        custom_tracking_reference=booking.custom_tracking_ref,
    )
    waybill = (resp.get('short_tracking_reference')
               or resp.get('custom_tracking_reference')
               or resp.get('tracking_reference', ''))
    ShipLogicShipment.objects.update_or_create(
        booking=booking,
        defaults={'shiplogic_id': str(resp.get('id', '')), 'waybill': waybill,
                  'service_level_code': resp.get('service_level_code', ''),
                  'status': 'created', 'raw_response': resp},
    )
    if booking.status == 'charged':
        booking.status = 'dispatched'
    booking.waybill = waybill or booking.waybill
    booking.shiplogic_id = str(resp.get('id', '')) or booking.shiplogic_id
    booking.save(update_fields=['status', 'waybill', 'shiplogic_id', 'updated_at'])
    # Index the partner identifiers so their webhooks resolve back to this booking.
    if waybill:
        booking.attach_identifier('waybill', waybill)
    if resp.get('id'):
        booking.attach_identifier('shiplogic_id', str(resp['id']))
    # Refresh the unified shipment projection with the new waybill + consignment.
    from backend.tracking.services import project_booking
    project_booking(booking)

    # Chain the real charge onto the client's ShipLogic statement, and tell the
    # engine the shipment is live. Both idempotent.
    events.enqueue('shiplogic.billing', 'booking.charge',
                   f"sl:debit:{booking.reference}",
                   {'booking_reference': booking.reference, 'kind': 'admin-debit',
                    'amount_cents': booking.price_cents, 'waybill': waybill})
    events.enqueue_engine_event(
        events.SHIPMENT_DISPATCHED, f"engine:shipment:{booking.reference}",
        {'booking_reference': booking.reference, 'waybill': waybill,
         'shiplogic_id': str(resp.get('id', ''))})


def _handle_shiplogic_billing(msg: OutboxMessage):
    kind = msg.payload['kind']
    amount_cents = msg.payload['amount_cents']

    if 'booking_reference' in msg.payload:
        booking = Booking.objects.get(reference=msg.payload['booking_reference'])
        wallet = Wallet.objects.get(client=booking.client)
        account_id = wallet.shiplogic_account_id
        waybill = msg.payload.get('waybill', '')
        # Hard duplicate guard: one txn of each kind per booking.
        existing = ShipLogicBillingTxn.objects.filter(booking=booking, kind=kind).first()
        if existing and existing.status == 'posted':
            return
        desc = (f"Special trip {booking.reference}" if kind == 'admin-debit'
                else f"Reversal {booking.reference}")
        txn = existing or ShipLogicBillingTxn(booking=booking, kind=kind,
                                              amount_cents=amount_cents, account_id=account_id)
    else:
        topup = TopUp.objects.get(pk=msg.payload['topup_id'])
        wallet = Wallet.objects.get(client=topup.client)
        account_id = wallet.shiplogic_account_id
        waybill = ''
        existing = ShipLogicBillingTxn.objects.filter(topup=topup, kind=kind).first()
        if existing and existing.status == 'posted':
            return
        desc = f"Top-up payment {format_rands(amount_cents)}"
        txn = existing or ShipLogicBillingTxn(topup=topup, kind=kind,
                                              amount_cents=amount_cents, account_id=account_id)

    if not account_id:
        raise shiplogic_client.ShipLogicNotConfigured("no shiplogic_account_id")

    resp = shiplogic_client.post_billing_transaction(
        kind=kind, description=desc, amount_cents=amount_cents,
        account_id=account_id, shiplogic_reference=waybill)
    txn.status = 'posted'
    txn.shiplogic_reference = waybill
    txn.raw_response = resp
    txn.save()



def _handle_treasury_allocate(msg: OutboxMessage):
    """Run the contribution-margin allocation for a charged booking. Idempotent,
    so redelivery is safe and a failed run simply retries."""
    from .treasury.services import allocate_for_booking
    ref = msg.payload.get('booking_reference')
    booking = Booking.objects.filter(reference=ref).first()
    if booking is None:
        return  # nothing to allocate; ack
    allocate_for_booking(booking)


HANDLERS = {
    'engine.event': _handle_engine_event,
    'shiplogic.shipment': _handle_shiplogic_shipment,
    'shiplogic.billing': _handle_shiplogic_billing,
    'treasury.allocate': _handle_treasury_allocate,
}


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------
def _claim_due(limit: int):
    qs = (OutboxMessage.objects
          .filter(status='pending', next_attempt_at__lte=timezone.now())
          .order_by('next_attempt_at', 'id'))
    if connection.features.has_select_for_update_skip_locked:
        qs = qs.select_for_update(skip_locked=True)
    return list(qs[:limit])


def dispatch_due(limit: int = 100) -> dict:
    """Process up to `limit` due messages. Returns counters."""
    stats = {'sent': 0, 'soft_retry': 0, 'retry': 0, 'dead': 0}
    with transaction.atomic():
        due = _claim_due(limit)
        ids = [m.id for m in due]

    for mid in ids:
        with transaction.atomic():
            try:
                msg = (OutboxMessage.objects.select_for_update()
                       .get(pk=mid, status='pending'))
            except OutboxMessage.DoesNotExist:
                continue
            handler = HANDLERS.get(msg.topic)
            if handler is None:
                msg.status = 'failed'
                msg.last_error = f"no handler for topic {msg.topic}"
                msg.save(update_fields=['status', 'last_error'])
                stats['dead'] += 1
                continue
            try:
                handler(msg)
                msg.status = 'sent'
                msg.sent_at = timezone.now()
                msg.last_error = ''
                msg.save(update_fields=['status', 'sent_at', 'last_error'])
                stats['sent'] += 1
            except SOFT_ERRORS as exc:
                msg.next_attempt_at = timezone.now() + timedelta(seconds=SOFT_RETRY_SECONDS)
                msg.last_error = f"soft: {exc}"
                msg.save(update_fields=['next_attempt_at', 'last_error'])
                stats['soft_retry'] += 1
            except Exception as exc:  # hard error: backoff, then dead-letter
                msg.attempts += 1
                msg.last_error = f"{type(exc).__name__}: {exc}"[:2000]
                if msg.attempts >= msg.max_attempts:
                    msg.status = 'failed'
                    stats['dead'] += 1
                else:
                    msg.next_attempt_at = timezone.now() + timedelta(seconds=_backoff(msg.attempts))
                    stats['retry'] += 1
                msg.save(update_fields=['attempts', 'last_error', 'status', 'next_attempt_at'])
                log.warning("outbox %s failed: %s", msg.id, msg.last_error)
    return stats
