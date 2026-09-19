"""
Inbound and read endpoints for the unified shipment view.

  POST /api/webhooks/shiplogic/tracking   ShipLogic status webhook (shared secret)
  POST /api/sync/shipments                cross-source ingest from the API platform (DAA-signed)
  POST /api/sync/driver-position          live driver fix from the route planner (DAA-signed)
  GET  /api/portal/shipments              client-scoped unified list for the dashboard
"""
import json

from django.conf import settings
from django.http import JsonResponse
from django.utils.dateparse import parse_date
from django.views.decorators.csrf import csrf_exempt

from backend.finance.signing import daa_verify, fixed_time_equals
from . import services
from .models import Shipment


def _raw(request):
    return request.body or b''


def _json(request):
    try:
        return json.loads(_raw(request) or b'{}')
    except ValueError:
        return None


# --------------------------------------------------------------------------
# ShipLogic tracking webhook (real shape). Shared-secret auth matching the
# platform: X-Webhook-Secret or the Authorization header (Bearer-stripped).
# --------------------------------------------------------------------------
@csrf_exempt
def shiplogic_tracking_webhook(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    secret = getattr(settings, 'SHIPLOGIC_WEBHOOK_SECRET', '') or ''
    if secret:
        presented = request.headers.get('X-Webhook-Secret', '')
        if not presented:
            auth = request.headers.get('Authorization', '')
            presented = auth[7:].strip() if auth.lower().startswith('bearer ') else auth.strip()
        if not fixed_time_equals(presented, secret):
            return JsonResponse({'error': 'invalid webhook secret'}, status=401)

    payload = _json(request)
    if payload is None:
        return JsonResponse({'error': 'invalid JSON'}, status=400)
    shipment = services.ingest_tracking(payload)
    if shipment is None:
        # Acknowledge so ShipLogic does not retry a shipment we do not have yet.
        return JsonResponse({'message': 'shipment not found, acknowledged'}, status=200)
    return JsonResponse({'status': 'updated', 'stage': shipment.stage}, status=200)


# --------------------------------------------------------------------------
# Cross-source ingest: the API platform pushes its (website/WooCommerce)
# shipments here so they appear in the same dashboard. DAA-signed.
# X-DAA-Token identifies the client (their ShipLogic account id).
# --------------------------------------------------------------------------
@csrf_exempt
def sync_shipments(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    secret = getattr(settings, 'DAA_SYNC_SECRET', '') or ''
    if secret and not daa_verify(secret, _raw(request), request.headers.get('X-DAA-Signature', '')):
        return JsonResponse({'error': 'bad signature'}, status=401)
    payload = _json(request)
    if payload is None:
        return JsonResponse({'error': 'invalid JSON'}, status=400)

    account_id = request.headers.get('X-DAA-Token', '') or payload.get('account_id', '')
    client = services._client_from_account(account_id)
    if client is None and payload.get('client_id'):
        from backend.quotes.models import Client
        client = Client.objects.filter(pk=payload['client_id']).first()
    if client is None:
        return JsonResponse({'error': 'client not mapped', 'account_id': account_id}, status=404)

    items = payload.get('shipments') or [payload]
    out = [services.ingest_api_shipment(client, it).id for it in items]
    return JsonResponse({'synced': len(out), 'shipment_ids': out}, status=200)


# --------------------------------------------------------------------------
# Live driver position from the route planner (push). DAA-signed. Resolves the
# shipment by any identifier.
# --------------------------------------------------------------------------
@csrf_exempt
def driver_position(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    secret = getattr(settings, 'DAA_SYNC_SECRET', '') or ''
    if secret and not daa_verify(secret, _raw(request), request.headers.get('X-DAA-Signature', '')):
        return JsonResponse({'error': 'bad signature'}, status=401)
    payload = _json(request)
    if payload is None:
        return JsonResponse({'error': 'invalid JSON'}, status=400)
    shipment = services.find_shipment(
        consignment_id=str(payload.get('consignment_id', '') or ''),
        tracking_number=payload.get('tracking_number', '') or '',
        custom_ref=payload.get('custom_tracking_reference', '') or '')
    if shipment is None:
        return JsonResponse({'message': 'shipment not found'}, status=200)
    services.apply_driver_position(shipment, payload.get('lat'), payload.get('lng'),
                                   eta=payload.get('eta'), driver_name=payload.get('driver_name', ''))
    return JsonResponse({'status': 'ok'}, status=200)


# --------------------------------------------------------------------------
# Client-scoped unified list for the dashboard. Filter by stage and date.
# --------------------------------------------------------------------------
def portal_shipments(request, client_id):
    qs = Shipment.objects.filter(client_id=client_id)
    stage = request.GET.get('stage')
    if stage:
        qs = qs.filter(stage=stage)
    d_from = parse_date(request.GET.get('date_from', '') or '')
    d_to = parse_date(request.GET.get('date_to', '') or '')
    if d_from:
        qs = qs.filter(created_at__date__gte=d_from)
    if d_to:
        qs = qs.filter(created_at__date__lte=d_to)
    rows = []
    for s in qs[:200]:
        rows.append({
            'tracking_number': s.tracking_number, 'consignment_id': s.consignment_id,
            'origin': s.origin, 'source_store': s.source_store,
            'stage': s.stage, 'status_raw': s.status_raw,
            'courier_service': s.courier_service,
            'shipping_cost_cents': s.shipping_cost_cents,
            'collection': s.collection_summary, 'delivery': s.delivery_summary,
            'recipient': s.recipient_name,
            'estimated_delivery': s.estimated_delivery,
            'driver': ({'lat': s.driver_lat, 'lng': s.driver_lng, 'eta': s.driver_eta,
                        'name': s.driver_name} if s.stage == 'out_for_delivery' and s.driver_lat else None),
        })
    return JsonResponse({'client_id': int(client_id), 'count': len(rows), 'shipments': rows})
