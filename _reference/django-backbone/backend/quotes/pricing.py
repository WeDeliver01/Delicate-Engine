"""
Single source of truth for quote pricing.

Every code path that produces a price (the public estimate endpoint, the quote
save endpoint, and the frontend's display fetch) resolves a RateCard here and
computes with the same formula. Rates are NEVER trusted from the browser.
"""
from decimal import Decimal, ROUND_HALF_UP

from .models import RateCard, ClientQuoteLink


def get_default_rate_card():
    """Return the active default RateCard, creating a sensible one if none exists."""
    card = RateCard.objects.filter(is_default=True, is_active=True).first()
    if card is None:
        card, _ = RateCard.objects.get_or_create(
            name="Default",
            defaults={
                'cost_per_km': Decimal('1.70'),
                'margin_percent': Decimal('55.00'),
                'is_default': True,
                'is_active': True,
            },
        )
        if not card.is_default or not card.is_active:
            card.is_default = True
            card.is_active = True
            card.save()
    return card


def resolve_rate_card(token):
    """
    Given an optional client-link token, return (rate_card, client_link).

    - Valid, active, unexpired token  -> that client's card + the link
    - No token / invalid / expired    -> the default card + None
    """
    if token:
        link = (ClientQuoteLink.objects
                .select_related('rate_card', 'client')
                .filter(token=token)
                .first())
        if link and link.is_valid and link.rate_card.is_active:
            return link.rate_card, link
    return get_default_rate_card(), None


def compute_price(distance_km, rate_card):
    """Compute the customer price for a distance using a RateCard.

    base  = (distance * cost_per_km) / (1 - margin_fraction)
    price = base + fuel_surcharge, floored at min_delivery_fee
    """
    distance = Decimal(str(distance_km or 0))
    cost_per_km = Decimal(rate_card.cost_per_km)
    margin = Decimal(rate_card.margin_fraction)
    if margin >= Decimal('1'):
        margin = Decimal('0.99')  # guard against divide-by-zero

    cogs = distance * cost_per_km
    base = cogs / (Decimal('1') - margin)
    fuel = base * (Decimal(rate_card.fuel_surcharge_percent) / Decimal('100'))
    price = base + fuel

    floor = Decimal(rate_card.min_delivery_fee or 0)
    if floor and price < floor:
        price = floor

    def q(v):
        return v.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    return {
        'distance_km': float(q(distance)),
        'cogs': float(q(cogs)),
        'price': float(q(price)),
        'margin_fraction': float(margin),
        'cost_per_km': float(cost_per_km),
        'rate_card': rate_card.name,
    }
