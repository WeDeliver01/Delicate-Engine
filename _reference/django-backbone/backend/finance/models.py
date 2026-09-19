"""
Finance & event-backbone data model.

Design rules baked into these tables:
  * The financial engine is the system of record for money. These tables are the
    LOCAL durable record + the gating balance + the outbox. They must be able to
    rebuild/reconcile against the engine, never the other way around.
  * Money is integer cents (BigInteger). No floats, no Decimal storage here.
  * The ledger is append-only. Reversals are new compensating rows, never edits.
  * Every outward integration (engine push, ShipLogic call) goes through
    OutboxMessage so it is persisted first and can be reattempted.
"""
from django.db import models
from django.utils import timezone


# ---------------------------------------------------------------------------
# Wallet + local append-only ledger (gating balance; mirror of the engine)
# ---------------------------------------------------------------------------
class Wallet(models.Model):
    """One wallet per client. balance_cents is the authoritative number the
    booking gate checks. It is updated synchronously inside the same DB
    transaction as every LedgerEntry, and reconciled against the engine."""
    client = models.OneToOneField('quotes.Client', on_delete=models.PROTECT,
                                  related_name='wallet')
    balance_cents = models.BigIntegerField(default=0)
    # The engine's account id this wallet maps to (set once known). The identity
    # key that ties a Django Client to an engine account.
    engine_account_ref = models.CharField(max_length=64, blank=True, db_index=True)
    # The client's unique ShipLogic account id (ShipLogic invoices the client).
    shiplogic_account_id = models.CharField(max_length=64, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        from .money import format_rands
        return f"Wallet({self.client_id}) {format_rands(self.balance_cents)}"


class LedgerEntry(models.Model):
    """Append-only local ledger. amount_cents is signed: credit positive, debit
    negative. balance_after_cents snapshots the wallet balance immediately after
    this entry, so the ledger is independently auditable."""
    KIND_CHOICES = [
        ('topup', 'Top-up'),
        ('booking_charge', 'Booking charge'),
        ('booking_reversal', 'Booking reversal'),
        ('adjustment', 'Manual adjustment'),
    ]
    wallet = models.ForeignKey(Wallet, on_delete=models.PROTECT, related_name='entries')
    kind = models.CharField(max_length=32, choices=KIND_CHOICES)
    amount_cents = models.BigIntegerField(help_text="Signed. Credit > 0, debit < 0.")
    balance_after_cents = models.BigIntegerField()
    # Free-form link back to whatever caused this (booking id, topup id, etc.)
    reference = models.CharField(max_length=128, db_index=True)
    description = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['id']
        indexes = [models.Index(fields=['wallet', 'id'])]

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValueError("LedgerEntry is append-only and cannot be modified.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("LedgerEntry is append-only and cannot be deleted.")


# ---------------------------------------------------------------------------
# Top-ups (client loads funds via a payment link)
# ---------------------------------------------------------------------------
class TopUp(models.Model):
    STATUS = [
        ('pending', 'Pending'),        # link created, awaiting payment
        ('confirmed', 'Confirmed'),    # provider webhook confirmed, wallet credited
        ('failed', 'Failed'),
        ('expired', 'Expired'),
    ]
    client = models.ForeignKey('quotes.Client', on_delete=models.PROTECT, related_name='topups')
    amount_cents = models.BigIntegerField()
    status = models.CharField(max_length=16, choices=STATUS, default='pending', db_index=True)
    # Provider linkage
    provider = models.CharField(max_length=40, default='bobpay')
    provider_reference = models.CharField(max_length=128, blank=True, db_index=True)
    payment_url = models.URLField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        from .money import format_rands
        return f"TopUp({self.client_id}, {format_rands(self.amount_cents)}, {self.status})"


# ---------------------------------------------------------------------------
# Bookings (a quote converted into a charged, dispatchable job)
# ---------------------------------------------------------------------------
class Booking(models.Model):
    STATUS = [
        ('rejected_insufficient_funds', 'Rejected: insufficient funds'),
        ('rejected_slot_unavailable', 'Rejected: slot unavailable'),
        ('charged', 'Charged'),                 # wallet debited, ready to dispatch
        ('dispatched', 'Dispatched to ShipLogic'),
        ('reversed', 'Reversed / cancelled'),
    ]
    client = models.ForeignKey('quotes.Client', on_delete=models.PROTECT, related_name='bookings')
    quote = models.ForeignKey('quotes.Quote', null=True, blank=True,
                              on_delete=models.SET_NULL, related_name='bookings')
    # The capacity slot this booking consumes (null for admin/ad-hoc bookings).
    slot = models.ForeignKey('scheduling.DeliverySlot', null=True, blank=True,
                             on_delete=models.PROTECT, related_name='bookings')
    # Snapshot of the priced amount at booking time (engine truth is the ledger).
    price_cents = models.BigIntegerField()
    status = models.CharField(max_length=40, choices=STATUS, db_index=True)
    # Stable internal reference used as the idempotency anchor across engine + ShipLogic.
    reference = models.CharField(max_length=64, unique=True, db_index=True)
    # Addresses/contacts handed to ShipLogic on dispatch (JSON to stay flexible).
    collection = models.JSONField(default=dict, blank=True)
    delivery = models.JSONField(default=dict, blank=True)
    parcels = models.JSONField(default=list, blank=True)
    # Cross-system identity. Every partner's id for this job is also indexed in
    # BookingIdentifier so any of them resolves back to this one booking.
    waybill = models.CharField(max_length=64, blank=True, db_index=True)
    custom_tracking_ref = models.CharField(max_length=64, blank=True, db_index=True)
    customer_reference = models.CharField(max_length=120, blank=True, db_index=True)
    shiplogic_id = models.CharField(max_length=64, blank=True, db_index=True)
    route_planner_id = models.CharField(max_length=64, blank=True, db_index=True)
    external_ids = models.JSONField(default=dict, blank=True)
    # Liability cover (special request; premium depends on declared value).
    liability_cover = models.BooleanField(default=False)
    declared_value_cents = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Booking({self.reference}, {self.status})"

    def attach_identifier(self, kind, value):
        """Index any external identifier so it resolves back to this booking."""
        if not value:
            return None
        obj, _ = BookingIdentifier.objects.update_or_create(
            kind=kind, value=str(value), defaults={'booking': self})
        return obj

    @classmethod
    def resolve(cls, value):
        """Find the booking for ANY identifier a partner system might send:
        our reference, the waybill, a custom/customer ref, a ShipLogic or route
        planner id, or any indexed external id. One lookup, consistent everywhere."""
        if not value:
            return None
        value = str(value)
        ident = BookingIdentifier.objects.filter(value=value).select_related('booking').first()
        if ident:
            return ident.booking
        from django.db.models import Q
        return cls.objects.filter(
            Q(reference=value) | Q(waybill=value) | Q(custom_tracking_ref=value) |
            Q(customer_reference=value) | Q(shiplogic_id=value) |
            Q(route_planner_id=value)).first()


# ---------------------------------------------------------------------------
# ShipLogic execution records (what we actually pushed to ShipLogic)
# ---------------------------------------------------------------------------
class ShipLogicShipment(models.Model):
    booking = models.OneToOneField(Booking, on_delete=models.PROTECT, related_name='shipment')
    shiplogic_id = models.CharField(max_length=64, blank=True)
    waybill = models.CharField(max_length=64, blank=True, db_index=True)
    service_level_code = models.CharField(max_length=32, blank=True)
    status = models.CharField(max_length=40, default='pending')
    raw_response = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ShipLogicBillingTxn(models.Model):
    KIND = [
        ('admin-debit', 'admin-debit'),     # special-trip charge
        ('admin-credit', 'admin-credit'),   # reversal
        ('payment', 'payment'),             # top-up reflected onto the statement
    ]
    # booking is optional: top-up payments link to a TopUp, not a Booking.
    booking = models.ForeignKey(Booking, null=True, blank=True,
                                on_delete=models.PROTECT, related_name='billing_txns')
    topup = models.ForeignKey(TopUp, null=True, blank=True,
                              on_delete=models.PROTECT, related_name='billing_txns')
    kind = models.CharField(max_length=16, choices=KIND)
    amount_cents = models.BigIntegerField()
    account_id = models.CharField(max_length=64)
    shiplogic_reference = models.CharField(max_length=128, blank=True)
    status = models.CharField(max_length=20, default='pending')
    raw_response = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # One billing transaction of each kind per booking: hard guard against
        # double-charging when a push is retried.
        constraints = [
            models.UniqueConstraint(
                fields=['booking', 'kind'],
                condition=models.Q(booking__isnull=False),
                name='uniq_billing_per_booking_kind',
            ),
        ]


# ---------------------------------------------------------------------------
# Parcel line items + the universal identity index
# ---------------------------------------------------------------------------
class Parcel(models.Model):
    """A physical parcel on a booking. Volumetric and charged weight are derived,
    mirroring the rate display (charged weight = max(actual, volumetric))."""
    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name='parcel_items')
    index = models.PositiveIntegerField(default=1)
    package_type = models.ForeignKey('catalog.PackageType', null=True, blank=True,
                                     on_delete=models.PROTECT, related_name='parcels')
    parcel_category = models.ForeignKey('catalog.ParcelCategory', null=True, blank=True,
                                        on_delete=models.PROTECT, related_name='parcels')
    length_cm = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    width_cm = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    height_cm = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    weight_kg = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    alt_tracking_ref = models.CharField(max_length=64, blank=True)
    description = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ['booking', 'index']

    @property
    def volumetric_weight_kg(self):
        from decimal import Decimal, ROUND_HALF_UP
        vol = (self.length_cm * self.width_cm * self.height_cm) / Decimal('5000')
        return vol.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    @property
    def charged_weight_kg(self):
        return max(self.weight_kg, self.volumetric_weight_kg)


class BookingIdentifier(models.Model):
    """One row per external identifier for a booking. The unique value index is
    the join key that makes every endpoint (ShipLogic, route planner, CRM,
    loyalty engine) resolve to the same booking, so nothing slips through."""
    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name='identifiers')
    kind = models.CharField(max_length=40)   # waybill | customer_ref | shiplogic_id | route_planner_id | ...
    value = models.CharField(max_length=160, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['value'], name='uniq_identifier_value'),
        ]

    def __str__(self):
        return f"{self.kind}:{self.value} -> {self.booking_id}"


# ---------------------------------------------------------------------------
# Inbound idempotency: dedupe webhooks we receive (payment, ShipLogic)
# ---------------------------------------------------------------------------
class ProviderEvent(models.Model):
    provider = models.CharField(max_length=40)
    external_id = models.CharField(max_length=160)
    received_at = models.DateTimeField(auto_now_add=True)
    payload = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['provider', 'external_id'],
                                    name='uniq_inbound_provider_event'),
        ]


# ---------------------------------------------------------------------------
# Transactional outbox: the durable, reattemptable integration queue
# ---------------------------------------------------------------------------
class OutboxMessage(models.Model):
    """Every outward side-effect is written here, in the SAME transaction as the
    state change that produced it. A dispatcher delivers it later with retries.
    Nothing is ever lost, and anything can be reattempted or reconciled."""
    TOPIC = [
        ('engine.event', 'Push event to financial engine'),
        ('shiplogic.shipment', 'Create shipment in ShipLogic'),
        ('shiplogic.billing', 'Post billing transaction in ShipLogic'),
    ]
    STATUS = [
        ('pending', 'Pending'),
        ('sent', 'Sent'),
        ('failed', 'Failed (dead-letter, manual reattempt)'),
    ]
    topic = models.CharField(max_length=40, choices=TOPIC, db_index=True)
    event_type = models.CharField(max_length=60, db_index=True)
    # Idempotency key: unique, so enqueuing twice is a no-op and the receiver can
    # dedupe. Built from the aggregate + event so retries collapse.
    idempotency_key = models.CharField(max_length=160, unique=True)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=12, choices=STATUS, default='pending', db_index=True)
    attempts = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=12)
    next_attempt_at = models.DateTimeField(default=timezone.now, db_index=True)
    last_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['next_attempt_at', 'id']
        indexes = [models.Index(fields=['status', 'next_attempt_at'])]

    def __str__(self):
        return f"Outbox[{self.topic}/{self.event_type}] {self.status} a{self.attempts}"

# Treasury allocation engine models (backend.finance.treasury)
from .treasury.models import (AllocationWallet, FundingTarget, ExpenseObligation,  # noqa: E402,F401
                              AllocationRule, AllocationTransaction)
