"""
Client for the ShipLogic Admin API.

Two operations are used by the backbone:
  * create_shipment  -> POST /shipments?account_id=X  (R0 catch-all service level)
  * post_billing_transaction -> POST /billing/transactions  (admin-debit/credit/payment)

ShipLogic amounts are in major units (rands), so cents are converted at this
boundary only. ShipLogic has no idempotency key, so callers must guard duplicates
(the outbox idempotency_key + the ShipLogicBillingTxn unique constraint do that).
"""
import requests
from django.conf import settings

from ..money import to_rands


class ShipLogicError(Exception):
    """Retryable transport/HTTP error."""


class ShipLogicNotConfigured(Exception):
    """Token/provider not set yet. Soft-retry, never dead-letter."""


def _cfg(name, default=None):
    return getattr(settings, name, default)


def _headers():
    token = _cfg('SHIPLOGIC_TOKEN', '')
    if not token:
        raise ShipLogicNotConfigured("SHIPLOGIC_TOKEN is not set")
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


def _address(block):
    """Build a ShipLogic address. Omits lat/lng entirely when unset (ShipLogic
    rejects a payload carrying null lat/lng), and uses ShipLogic's field names."""
    a = (block or {}).get('address', {}) or {}
    out = {
        'type': a.get('type', 'residential'),
        'street_address': a.get('street', a.get('street_address', '')),
        'local_area': a.get('suburb', a.get('local_area', '')),
        'city': a.get('city', ''),
        'code': a.get('postal_code', a.get('code', '')),
        'zone': a.get('province', a.get('zone', '')),
        'country': a.get('country', 'ZA'),
    }
    if a.get('company'):
        out['company'] = a['company']
    if a.get('lat') is not None and a.get('lng') is not None:
        out['lat'] = a['lat']
        out['lng'] = a['lng']
    return out


def _contact(block):
    c = (block or {}).get('contact', {}) or {}
    return {'name': c.get('name', ''), 'mobile_number': c.get('phone', c.get('mobile_number', '')),
            'email': c.get('email', '')}


def _parcels(parcels):
    """ShipLogic parcel shape: `packaging` shows as PACKAGE TYPE, `parcel_description`
    as PARCEL CATEGORY, dimensions as submitted_*_cm, weight as submitted_weight_kg."""
    out = []
    for p in (parcels or [{}]):
        out.append({
            'packaging': p.get('package_type') or p.get('packaging') or None,
            'parcel_description': p.get('parcel_category') or p.get('description') or None,
            'submitted_length_cm': float(p.get('length_cm', 0) or 0),
            'submitted_width_cm': float(p.get('width_cm', 0) or 0),
            'submitted_height_cm': float(p.get('height_cm', 0) or 0),
            'submitted_weight_kg': float(p.get('weight_kg', 0) or 1),
        })
    return out


def create_shipment(account_id: str, collection: dict, delivery: dict,
                    parcels: list, service_level_code: str | None = None,
                    customer_reference: str = '', custom_tracking_reference: str = '') -> dict:
    base = _cfg('SHIPLOGIC_API_URL', 'https://api.shiplogic.com')
    slc = service_level_code or _cfg('SHIPLOGIC_CATCHALL_SERVICE_LEVEL_CODE', 'SPX')
    headers = _headers()
    # Contacts are siblings of the addresses for shipment creation (for /rates
    # they nest inside the address instead).
    body = {
        'service_level_code': slc,
        'collection_address': _address(collection),
        'collection_contact': _contact(collection),
        'delivery_address': _address(delivery),
        'delivery_contact': _contact(delivery),
        'parcels': _parcels(parcels),
        'mute_notifications': False,
    }
    if customer_reference:
        body['customer_reference'] = customer_reference
    if custom_tracking_reference:
        body['custom_tracking_reference'] = custom_tracking_reference
    if account_id:
        body['account_id'] = int(account_id)
    provider_id = _cfg('SHIPLOGIC_PROVIDER_ID', None)
    if provider_id:
        body['provider_id'] = int(provider_id)
    try:
        resp = requests.post(f"{base}/shipments", json=body, headers=headers,
                             timeout=_cfg('SHIPLOGIC_TIMEOUT', 15))
    except requests.RequestException as exc:
        raise ShipLogicError(f"shipment request failed: {exc}") from exc
    if resp.status_code not in (200, 201):
        raise ShipLogicError(f"shipment create {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def post_billing_transaction(kind: str, description: str, amount_cents: int,
                             account_id: str, shiplogic_reference: str = '') -> dict:
    """kind is one of admin-debit | admin-credit | payment.
    amount is sent positive in rands; the kind sets the direction."""
    base = _cfg('SHIPLOGIC_API_URL', 'https://api.shiplogic.com')
    provider_id = _cfg('SHIPLOGIC_PROVIDER_ID', None)
    headers = _headers()
    body = {
        'type': kind,
        'description': description,
        'amount': float(to_rands(abs(amount_cents))),
        'account_id': int(account_id),
        'provider_id': int(provider_id) if provider_id is not None else None,
    }
    if shiplogic_reference:
        body['shipment_reference'] = shiplogic_reference
    try:
        resp = requests.post(f"{base}/billing/transactions", json=body,
                             headers=headers, timeout=_cfg('SHIPLOGIC_TIMEOUT', 15))
    except requests.RequestException as exc:
        raise ShipLogicError(f"billing request failed: {exc}") from exc
    if resp.status_code not in (200, 201):
        raise ShipLogicError(f"billing post {resp.status_code}: {resp.text[:300]}")
    return resp.json()
