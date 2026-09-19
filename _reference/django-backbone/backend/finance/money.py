"""
Money lives in integer cents everywhere inside the finance app and on the wire
to the financial engine. The Django side touches Decimal rands only at the
boundary with the existing quotes app (whose prices are Decimal rands), and the
conversion happens in exactly one place: here.

Never store, add, or compare money as float. Never round twice.
"""
from decimal import Decimal, ROUND_HALF_UP

CENTS = Decimal('1')
RANDS = Decimal('0.01')


def to_cents(rands) -> int:
    """Decimal/str/int rands -> integer cents, rounded half-up once."""
    if rands is None:
        return 0
    d = rands if isinstance(rands, Decimal) else Decimal(str(rands))
    return int((d * 100).quantize(CENTS, rounding=ROUND_HALF_UP))


def to_rands(cents: int) -> Decimal:
    """Integer cents -> Decimal rands (2dp). Used only when talking to systems
    that expect major units, e.g. ShipLogic's billing amount field."""
    return (Decimal(int(cents)) / 100).quantize(RANDS, rounding=ROUND_HALF_UP)


def format_rands(cents: int) -> str:
    return f"R{to_rands(cents):,.2f}"
