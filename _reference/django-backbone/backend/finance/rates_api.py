"""
Real rate endpoints. The booking flow already prices via the quote generator's
compute_price; these expose the same math so the portal can quote live and the
super admin can manage the per-client rate cards that drive it. No mock numbers.
"""
import json
from decimal import Decimal

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from backend.quotes.models import RateCard, ClientQuoteLink
from backend.quotes.pricing import compute_price, get_default_rate_card
from backend.accounts.decorators import require_super_admin
from .money import to_cents


def resolve_card(client_id=None, rate_card_id=None):
    """The card that prices this job: an explicit card, else the client's active
    card (via their quote link), else the default."""
    if rate_card_id:
        c = RateCard.objects.filter(pk=rate_card_id).first()
        if c:
            return c
    if client_id:
        link = (ClientQuoteLink.objects.filter(client_id=client_id, is_active=True)
                .select_related('rate_card').first())
        if link:
            return link.rate_card
    return get_default_rate_card()


def _breakdown(card, distance_km):
    res = compute_price(distance_km, card)
    total = to_cents(res['price'])
    fuel_pct = Decimal(card.fuel_surcharge_percent or 0)
    base = int(round(total / float(1 + fuel_pct / 100))) if fuel_pct else total
    return {
        'rate_card': card.name, 'distance_km': res['distance_km'],
        'total_cents': total, 'base_cents': base, 'fuel_levy_cents': total - base,
        'cost_per_km': res['cost_per_km'], 'margin_fraction': res['margin_fraction'],
        'min_delivery_fee_cents': to_cents(card.min_delivery_fee),
    }


@csrf_exempt
def rate_quote(request):
    """POST {distance_km, client_id?|rate_card_id?} -> live rate breakdown."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        data = json.loads(request.body or b'{}')
    except ValueError:
        return JsonResponse({'error': 'invalid JSON'}, status=400)
    card = resolve_card(data.get('client_id'), data.get('rate_card_id'))
    return JsonResponse(_breakdown(card, data.get('distance_km', 0)))


def _card_dict(card):
    link = card.links.filter(is_active=True).select_related('client').first()
    return {'id': card.id, 'name': card.name, 'cost_per_km': str(card.cost_per_km),
            'margin_percent': str(card.margin_percent),
            'fuel_surcharge_percent': str(card.fuel_surcharge_percent),
            'min_delivery_fee': str(card.min_delivery_fee),
            'is_default': card.is_default, 'is_active': card.is_active,
            'client': (link.client.name if link else None),
            'client_id': (link.client_id if link else None)}


@csrf_exempt
@require_super_admin
def rate_cards(request):
    """GET list all cards; PUT {id, cost_per_km, margin_percent,
    fuel_surcharge_percent, min_delivery_fee} to update one card's levers."""
    if request.method == 'GET':
        return JsonResponse({'rate_cards': [_card_dict(c) for c in
                             RateCard.objects.all().prefetch_related('links')]})
    if request.method in ('PUT', 'POST'):
        try:
            data = json.loads(request.body or b'{}')
        except ValueError:
            return JsonResponse({'error': 'invalid JSON'}, status=400)
        card = RateCard.objects.filter(pk=data.get('id')).first()
        if card is None:
            return JsonResponse({'error': 'unknown rate card'}, status=404)
        for f in ('cost_per_km', 'margin_percent', 'fuel_surcharge_percent', 'min_delivery_fee'):
            if f in data:
                setattr(card, f, Decimal(str(data[f])))
        card.save()
        return JsonResponse({'status': 'updated', 'rate_card': _card_dict(card)})
    return JsonResponse({'error': 'GET or PUT'}, status=405)
