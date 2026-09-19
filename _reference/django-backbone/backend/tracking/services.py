"""
Sync logic for the unified shipment view.

Two inflows, one table:
  * project_booking(booking)      portal-origin -> Shipment
  * ingest_api_shipment(...)      API/website-origin (from the platform) -> Shipment
Both resolve to a client and index identity. Then one inflow updates them all:
  * ingest_tracking(payload)      ShipLogic webhook -> status + events, by identity

ingest_tracking is the source of truth for status, exactly as decided: ShipLogic
webhooks land here directly and update whichever shipment matches, no matter
which source created it.
"""
from django.db import transaction
from django.utils import timezone

from .models import Shipment, TrackingEvent, normalize_status


def _client_from_account(account_id):
    """Map a ShipLogic account id to our client via the wallet mapping."""
    if not account_id:
        return None
    from backend.finance.models import Wallet
    w = Wallet.objects.filter(shiplogic_account_id=str(account_id)).select_related('client').first()
    return w.client if w else None


def find_shipment(consignment_id='', tracking_number='', custom_ref='', customer_ref=''):
    """Resolve a unified shipment by any identifier, falling back to the booking
    identity index so a portal booking not yet projected is still found."""
    for field, val in [('consignment_id', consignment_id), ('tracking_number', tracking_number),
                       ('custom_tracking_reference', custom_ref), ('customer_reference', customer_ref)]:
        if val:
            s = Shipment.objects.filter(**{field: val}).first()
            if s:
                return s
    from backend.finance.models import Booking
    for val in (consignment_id, tracking_number, custom_ref, customer_ref):
        if val:
            b = Booking.resolve(val)
            if b:
                return project_booking(b)
    return None


@transaction.atomic
def project_booking(booking):
    """Create or refresh the Shipment row for a portal booking."""
    coll = (booking.collection or {})
    deliv = (booking.delivery or {})
    shipment, _ = Shipment.objects.update_or_create(
        booking=booking,
        defaults={
            'client': booking.client, 'origin': 'portal',
            'consignment_id': booking.shiplogic_id or '',
            'tracking_number': booking.waybill or '',
            'custom_tracking_reference': booking.custom_tracking_ref or '',
            'customer_reference': booking.customer_reference or '',
            'shipping_cost_cents': booking.price_cents,
            'collection_summary': (coll.get('address', {}) or {}).get('street', '')[:255],
            'delivery_summary': (deliv.get('address', {}) or {}).get('street', '')[:255],
            'recipient_name': (deliv.get('contact', {}) or {}).get('name', '')[:160],
            'stage': _stage_for_booking(booking),
        })
    return shipment


def _stage_for_booking(booking):
    if booking.status == 'dispatched':
        return 'created'
    if booking.status == 'reversed':
        return 'cancelled'
    return 'created'


@transaction.atomic
def ingest_api_shipment(client, payload):
    """Upsert a shipment that originated outside the portal (website API)."""
    key = {'consignment_id': payload.get('consignment_id', '') or '',
           'tracking_number': payload.get('tracking_number', '') or ''}
    existing = find_shipment(**key)
    defaults = {
        'client': client, 'origin': payload.get('origin', 'api'),
        'source_store': payload.get('source_store', '')[:120],
        'consignment_id': key['consignment_id'], 'tracking_number': key['tracking_number'],
        'custom_tracking_reference': payload.get('custom_tracking_reference', '') or '',
        'customer_reference': payload.get('customer_reference', '') or '',
        'courier_service': payload.get('courier_service', '')[:40],
        'shipping_cost_cents': int(payload.get('shipping_cost_cents', 0) or 0),
        'collection_summary': payload.get('collection_summary', '')[:255],
        'delivery_summary': payload.get('delivery_summary', '')[:255],
        'recipient_name': payload.get('recipient_name', '')[:160],
    }
    if payload.get('status'):
        defaults['status_raw'] = payload['status']
        defaults['stage'] = normalize_status(payload['status'])
    if existing:
        for k, v in defaults.items():
            setattr(existing, k, v)
        existing.save()
        return existing
    return Shipment.objects.create(**defaults)


@transaction.atomic
def ingest_tracking(payload):
    """Apply a ShipLogic tracking webhook (real shape) to the matching shipment.
    Returns the shipment, or None if nothing matched (caller still acks)."""
    consignment = str(payload.get('shipment_id', '') or '')
    short_ref = payload.get('short_tracking_reference', '') or ''
    custom_ref = payload.get('custom_tracking_reference', '') or ''
    shipment = find_shipment(consignment_id=consignment, tracking_number=short_ref,
                             custom_ref=custom_ref)
    if shipment is None:
        return None

    # Backfill any identity we now learn, so future lookups are direct.
    shipment.consignment_id = shipment.consignment_id or consignment
    shipment.tracking_number = shipment.tracking_number or short_ref
    shipment.custom_tracking_reference = shipment.custom_tracking_reference or custom_ref

    if payload.get('status'):
        shipment.status_raw = payload['status']
        shipment.stage = normalize_status(payload['status'])
    for src, dst in [('shipment_estimated_collection', 'estimated_collection'),
                     ('shipment_estimated_delivery_to', 'estimated_delivery'),
                     ('shipment_delivered_date', 'actual_delivery')]:
        if payload.get(src):
            setattr(shipment, dst, payload[src])
    shipment.save()

    for ev in (payload.get('tracking_events') or []):
        TrackingEvent.objects.get_or_create(
            shipment=shipment, external_id=str(ev.get('id', '') or ''),
            defaults={'status': ev.get('status', ''), 'message': ev.get('message', '') or '',
                      'location': ev.get('location', '') or '', 'source': ev.get('source', '') or '',
                      'occurred_at': ev.get('date')})
    return shipment


@transaction.atomic
def apply_driver_position(shipment, lat, lng, eta=None, driver_name=''):
    """Update the live driver fix (from the route planner feed)."""
    shipment.driver_lat = lat
    shipment.driver_lng = lng
    if eta:
        shipment.driver_eta = eta
    if driver_name:
        shipment.driver_name = driver_name
    shipment.save(update_fields=['driver_lat', 'driver_lng', 'driver_eta',
                                 'driver_name', 'updated_at'])
    return shipment
