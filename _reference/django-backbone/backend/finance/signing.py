"""
HMAC-SHA256 signing, reused for two boundaries:
  - outbound pushes to the financial engine (so the engine can verify us)
  - inbound webhooks we receive (so we can verify the sender)

Mirrors the push/pull HMAC scheme already used by the Delicate API Adapter so
the engine side does not need a second verification path.
"""
import hashlib
import hmac
import time


def sign(secret: str, body: bytes, timestamp: str | None = None) -> tuple[str, str]:
    """Return (timestamp, signature) for a raw body. Signature covers
    "{timestamp}.{body}" to bind the signature to a moment in time."""
    ts = timestamp or str(int(time.time()))
    mac = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256)
    return ts, mac.hexdigest()


def verify(secret: str, body: bytes, timestamp: str, signature: str,
           max_skew_seconds: int = 300) -> bool:
    """Constant-time verify, with a replay window on the timestamp."""
    if not secret or not signature or not timestamp:
        return False
    try:
        if abs(int(time.time()) - int(timestamp)) > max_skew_seconds:
            return False
    except (TypeError, ValueError):
        return False
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + body,
                        hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# ---------------------------------------------------------------------------
# DAA scheme (adopted from the API platform's DaaSigUtil so the portal and the
# platform speak the same security language across the federation channel):
#   signature = base64(HMAC-SHA256(secret, raw_body)), constant-time compare.
# ---------------------------------------------------------------------------
import base64


def daa_sign(secret: str, raw_body: bytes) -> str:
    mac = hmac.new(secret.encode(), raw_body or b'', hashlib.sha256).digest()
    return base64.b64encode(mac).decode()


def daa_verify(secret: str, raw_body: bytes, header_value: str) -> bool:
    if not secret or not header_value:
        return False
    try:
        expected = base64.b64decode(daa_sign(secret, raw_body))
        provided = base64.b64decode(header_value.strip())
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(expected, provided)


def fixed_time_equals(a: str, b: str) -> bool:
    if not a or not b:
        return False
    return hmac.compare_digest(a, b)
