"""
Payment-provider client (BobPay or similar) plus webhook verification.

create_payment_link issues a hosted payment link for a top-up. We credit the
wallet ONLY on the provider's server-to-server webhook, never on the redirect,
and we dedupe webhooks by the provider reference.

A 'stub' provider is included so the whole flow runs locally without a live
merchant account; swap PAYMENTS_PROVIDER to 'bobpay' and fill the config to go
live. The live branch documents the request shape rather than guessing the
provider's exact contract.
"""
import secrets

import requests
from django.conf import settings

from ..signing import verify


class PaymentsError(Exception):
    pass


def _cfg(name, default=None):
    return getattr(settings, name, default)


def create_payment_link(amount_cents: int, reference: str) -> dict:
    """Return {'payment_url': str, 'provider_reference': str}."""
    provider = _cfg('PAYMENTS_PROVIDER', 'stub')
    if provider == 'stub':
        ref = f"stub_{reference}_{secrets.token_hex(4)}"
        return {'payment_url': f"https://pay.example/stub/{ref}",
                'provider_reference': ref}

    # Live provider (e.g. BobPay). Adjust to the provider's documented contract.
    url = _cfg('PAYMENTS_API_URL', '')
    api_key = _cfg('PAYMENTS_API_KEY', '')
    if not url or not api_key:
        raise PaymentsError("PAYMENTS_API_URL / PAYMENTS_API_KEY not configured")
    body = {
        'amount': amount_cents / 100,
        'reference': reference,
        'return_url': _cfg('PAYMENTS_RETURN_URL', ''),
        'webhook_url': _cfg('PAYMENTS_WEBHOOK_URL', ''),
    }
    resp = requests.post(url, json=body,
                         headers={'Authorization': f'Bearer {api_key}'},
                         timeout=_cfg('PAYMENTS_TIMEOUT', 15))
    if resp.status_code not in (200, 201):
        raise PaymentsError(f"payment link {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    return {'payment_url': data.get('url', ''),
            'provider_reference': data.get('reference', reference)}


def verify_webhook(raw_body: bytes, timestamp: str, signature: str) -> bool:
    secret = _cfg('PAYMENTS_WEBHOOK_SECRET', '')
    if _cfg('PAYMENTS_PROVIDER', 'stub') == 'stub' and not secret:
        return True  # dev convenience only; set a secret in any real environment
    return verify(secret, raw_body, timestamp, signature)
