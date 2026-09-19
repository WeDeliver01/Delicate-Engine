"""
Client for pushing domain events to the financial engine.

The engine is event-driven and async: we POST events to its ingest endpoint with
an HMAC signature and an idempotency key. If the engine URL is not yet wired,
push() raises EngineNotConfigured, which the dispatcher treats as a soft retry
(the message stays pending and is NOT counted toward dead-lettering). This is
what lets you build and run now, before the engine is connected: events queue
safely in the outbox and flush the moment ENGINE_INGEST_URL is set.
"""
import json

import requests
from django.conf import settings

from ..signing import sign


class EngineError(Exception):
    """Hard, retryable transport/HTTP error talking to the engine."""


class EngineNotConfigured(Exception):
    """Engine endpoint not configured yet. Soft-retry, never dead-letter."""


def push(event_type: str, payload: dict, idempotency_key: str) -> dict:
    url = getattr(settings, 'ENGINE_INGEST_URL', '') or ''
    if not url:
        raise EngineNotConfigured("ENGINE_INGEST_URL is not set")

    body = json.dumps({
        'event_type': event_type,
        'idempotency_key': idempotency_key,
        'payload': payload,
    }, separators=(',', ':')).encode()

    secret = getattr(settings, 'ENGINE_HMAC_SECRET', '') or ''
    ts, signature = sign(secret, body)
    headers = {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotency_key,
        'X-Delicate-Timestamp': ts,
        'X-Delicate-Signature': signature,
    }
    try:
        resp = requests.post(url, data=body, headers=headers,
                             timeout=getattr(settings, 'ENGINE_TIMEOUT', 10))
    except requests.RequestException as exc:
        raise EngineError(f"engine request failed: {exc}") from exc

    if resp.status_code in (200, 201, 202, 409):
        # 409 = engine already has this idempotency key. That is success for us.
        try:
            return resp.json()
        except ValueError:
            return {'status_code': resp.status_code}
    raise EngineError(f"engine returned {resp.status_code}: {resp.text[:300]}")
