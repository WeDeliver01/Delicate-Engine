"""
Event types and the enqueue helpers.

enqueue() writes an OutboxMessage. It MUST be called inside the same
transaction.atomic() block as the state change it describes, so that either both
the state and the event persist, or neither does (the transactional outbox
guarantee: no events for rolled-back state, no lost events for committed state).
"""
from .models import OutboxMessage

# Canonical domain event types pushed to the financial engine.
TOPUP_CONFIRMED = 'topup.confirmed'
BOOKING_CHARGED = 'booking.charged'
BOOKING_REVERSED = 'booking.reversed'
SHIPMENT_DISPATCHED = 'shipment.dispatched'
SHIPMENT_TRACKING = 'shipment.tracking'


def enqueue(topic: str, event_type: str, idempotency_key: str, payload: dict) -> OutboxMessage:
    """Idempotently enqueue an outbox message. Enqueuing the same idempotency_key
    twice is a no-op, which makes the producing operations safe to retry."""
    msg, _created = OutboxMessage.objects.get_or_create(
        idempotency_key=idempotency_key,
        defaults={'topic': topic, 'event_type': event_type, 'payload': payload},
    )
    return msg


def enqueue_engine_event(event_type: str, idempotency_key: str, payload: dict) -> OutboxMessage:
    """Push a domain event to the financial engine."""
    return enqueue('engine.event', event_type, idempotency_key, payload)
