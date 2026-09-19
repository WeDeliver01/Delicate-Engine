"""
HTTP surface the booking portal / frontend calls to trigger events. Thin: it
validates input, calls a domain service (which is atomic and emits outbox
events), and returns. All the money logic lives in services.py.

Webhooks read the raw body for signature verification, so they are plain Django
views with csrf_exempt. The provider's server-to-server call is the only thing
that confirms a top-up; the browser redirect never moves money.
"""
import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.db import transaction

from backend.quotes.models import Client
from . import services, events
from .clients import payments as payments_client
from .models import TopUp, Wallet, ProviderEvent, LedgerEntry
from .money import to_cents


def _json(request):
    try:
        return json.loads(request.body or b'{}')
    except ValueError:
        return None


@csrf_exempt
def book_from_quote(request):
    """POST: convert a quote into a booking. Body: {client_id, quote_id,
    collection, delivery, parcels, slot_date, slot_window, liability_cover,
    declared_value_cents, customer_reference, custom_tracking_ref}.
    Contacts are required here (collection + delivery name and phone)."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    data = _json(request)
    if data is None:
        return JsonResponse({'error': 'invalid JSON'}, status=400)
    try:
        client = Client.objects.get(pk=data['client_id'])
    except (KeyError, Client.DoesNotExist):
        return JsonResponse({'error': 'unknown client'}, status=404)
    from backend.quotes.models import Quote
    quote = Quote.objects.filter(pk=data.get('quote_id')).first()
    if quote is None:
        return JsonResponse({'error': 'unknown quote'}, status=404)

    try:
        booking = services.book_from_quote(
            client=client, quote=quote,
            collection=data.get('collection', {}), delivery=data.get('delivery', {}),
            parcels=data.get('parcels', []),
            slot_date=data.get('slot_date'), slot_window=data.get('slot_window'),
            liability_cover=bool(data.get('liability_cover', False)),
            declared_value_cents=int(data.get('declared_value_cents', 0) or 0),
            customer_reference=data.get('customer_reference', ''),
            custom_tracking_ref=data.get('custom_tracking_ref', ''))
    except services.MissingContactDetails as exc:
        return JsonResponse({'error': 'missing_contact_details',
                             'missing': exc.missing}, status=422)
    except services.SlotUnavailable as exc:
        return JsonResponse({'error': 'slot_unavailable', 'reason': str(exc)}, status=409)
    except services.InsufficientFunds as exc:
        return JsonResponse({'error': 'insufficient_funds',
                             'needed_cents': exc.needed_cents,
                             'available_cents': exc.available_cents}, status=402)
    return JsonResponse({
        'booking_reference': booking.reference, 'status': booking.status,
        'price_cents': booking.price_cents,
        'rate': services.rate_breakdown(quote, data.get('parcels', [])),
        'parcels': booking.parcel_items.count()}, status=201)


@csrf_exempt
def create_topup(request):
    """POST {client_id, amount_cents | amount_rands} -> payment link."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    data = _json(request)
    if data is None:
        return JsonResponse({'error': 'invalid JSON'}, status=400)
    try:
        client = Client.objects.get(pk=data['client_id'])
    except (KeyError, Client.DoesNotExist):
        return JsonResponse({'error': 'unknown client'}, status=404)
    amount_cents = data.get('amount_cents') or to_cents(data.get('amount_rands'))
    if not amount_cents or amount_cents <= 0:
        return JsonResponse({'error': 'amount required'}, status=400)

    topup = TopUp.objects.create(client=client, amount_cents=amount_cents)
    link = payments_client.create_payment_link(amount_cents, f"topup-{topup.id}")
    topup.payment_url = link['payment_url']
    topup.provider_reference = link['provider_reference']
    topup.save(update_fields=['payment_url', 'provider_reference'])
    return JsonResponse({'topup_id': topup.id, 'payment_url': topup.payment_url,
                         'provider_reference': topup.provider_reference}, status=201)


@csrf_exempt
def payment_webhook(request):
    """Provider server-to-server confirmation. Verifies signature, dedupes, and
    confirms the top-up (which credits the wallet and queues the engine push)."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    ts = request.headers.get('X-Delicate-Timestamp', '')
    sig = request.headers.get('X-Delicate-Signature', '')
    if not payments_client.verify_webhook(request.body, ts, sig):
        return JsonResponse({'error': 'bad signature'}, status=401)
    data = _json(request)
    if data is None:
        return JsonResponse({'error': 'invalid JSON'}, status=400)

    provider_ref = data.get('provider_reference') or data.get('reference', '')
    # Inbound idempotency: a redelivered webhook is acknowledged, not reprocessed.
    _, created = ProviderEvent.objects.get_or_create(
        provider='payment', external_id=provider_ref or 'unknown',
        defaults={'payload': data})
    if not created:
        return JsonResponse({'status': 'duplicate ignored'}, status=200)

    if data.get('status') not in ('paid', 'succeeded', 'confirmed', 'success'):
        return JsonResponse({'status': 'noted, not a success event'}, status=200)

    topup = TopUp.objects.filter(provider_reference=provider_ref).first()
    if topup is None:
        return JsonResponse({'error': 'no matching topup'}, status=404)
    services.confirm_topup(topup)
    return JsonResponse({'status': 'confirmed', 'topup_id': topup.id}, status=200)


@csrf_exempt
def create_booking(request):
    """POST {client_id, reference, price_cents|quote_id, collection, delivery,
    parcels} -> charge against wallet (gated) and queue dispatch."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    data = _json(request)
    if data is None:
        return JsonResponse({'error': 'invalid JSON'}, status=400)
    try:
        client = Client.objects.get(pk=data['client_id'])
    except (KeyError, Client.DoesNotExist):
        return JsonResponse({'error': 'unknown client'}, status=404)

    reference = data.get('reference')
    if not reference:
        return JsonResponse({'error': 'reference required'}, status=400)

    quote = None
    price_cents = data.get('price_cents')
    if data.get('quote_id'):
        from backend.quotes.models import Quote
        quote = Quote.objects.filter(pk=data['quote_id']).first()
        if quote and price_cents is None:
            price_cents = to_cents(quote.revenue)  # single conversion boundary
    if not price_cents or price_cents <= 0:
        return JsonResponse({'error': 'price_cents or a priced quote_id required'}, status=400)

    try:
        booking = services.charge_booking(
            client=client, price_cents=price_cents, reference=reference, quote=quote,
            collection=data.get('collection', {}), delivery=data.get('delivery', {}),
            parcels=data.get('parcels', []),
            slot_date=data.get('slot_date'), slot_window=data.get('slot_window'))
    except services.SlotUnavailable as exc:
        return JsonResponse({'error': 'slot_unavailable', 'reason': str(exc)}, status=409)
    except services.InsufficientFunds as exc:
        return JsonResponse({'error': 'insufficient_funds',
                             'needed_cents': exc.needed_cents,
                             'available_cents': exc.available_cents}, status=402)
    return JsonResponse({'booking_reference': booking.reference,
                         'status': booking.status,
                         'price_cents': booking.price_cents,
                         'slot': ({'date': data.get('slot_date'),
                                   'window_key': data.get('slot_window')}
                                  if booking.slot_id else None)}, status=201)


def wallet_detail(request, client_id):
    """GET wallet balance + recent ledger (ops/debug)."""
    wallet = Wallet.objects.filter(client_id=client_id).first()
    if wallet is None:
        return JsonResponse({'client_id': int(client_id), 'balance_cents': 0,
                             'entries': []})
    entries = (LedgerEntry.objects.filter(wallet=wallet).order_by('-id')[:25]
               .values('kind', 'amount_cents', 'balance_after_cents',
                       'reference', 'created_at'))
    return JsonResponse({'client_id': int(client_id),
                         'balance_cents': wallet.balance_cents,
                         'entries': list(entries)})


@csrf_exempt
def shiplogic_webhook(request):
    """Inbound ShipLogic tracking event. Stored and forwarded to the engine as a
    tracking event. Deduped by ShipLogic's shipment id + status."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    data = _json(request)
    if data is None:
        return JsonResponse({'error': 'invalid JSON'}, status=400)
    ext = f"{data.get('shipment_id', '')}:{data.get('status', '')}"
    _, created = ProviderEvent.objects.get_or_create(
        provider='shiplogic', external_id=ext or 'unknown', defaults={'payload': data})
    if not created:
        return JsonResponse({'status': 'duplicate ignored'}, status=200)
    with transaction.atomic():
        events.enqueue_engine_event(
            events.SHIPMENT_TRACKING,
            f"engine:tracking:{ext}",
            {'shipment_id': data.get('shipment_id'),
             'status': data.get('status'),
             'tracking_reference': data.get('custom_tracking_reference', '')})
    return JsonResponse({'status': 'accepted'}, status=200)
