"""
Unified shipment read-model.

One client dashboard must show every shipment, whether it was booked in our
portal or created through a merchant's website via the API platform. So both
sources project into ONE Shipment table here, each row tied to a client and
resolvable by any external identifier. Status and live events flow in from the
ShipLogic tracking webhook regardless of which source created the shipment.

This table is a projection, not the system of record for money (that stays in
the engine) or for the booking gate (that stays in finance). It exists to be
read fast by the dashboards and to be reconciled against ShipLogic and the
API platform.
"""
from django.db import models

ORIGINS = [
    ('portal', 'Booked in portal'),
    ('api', 'Created via website API'),
    ('woocommerce', 'WooCommerce store'),
    ('shopify', 'Shopify store'),
]

# Normalised lifecycle the dashboards render as a stepper. ShipLogic's many raw
# status strings map down to these.
STAGE = [
    ('created', 'Created'),
    ('collected', 'Collected'),
    ('in_transit', 'In transit'),
    ('out_for_delivery', 'Out for delivery'),
    ('delivered', 'Delivered'),
    ('cancelled', 'Cancelled'),
    ('exception', 'Exception'),
]

# ShipLogic raw status -> our stage. Unknown strings fall back to 'in_transit'.
STATUS_MAP = {
    'collection-assigned': 'created', 'collection assigned': 'created',
    'pending-collection': 'created', 'submitted': 'created', 'created': 'created',
    'collected': 'collected', 'at-collection-hub': 'collected',
    'in-transit': 'in_transit', 'at-delivery-hub': 'in_transit',
    'out-for-delivery': 'out_for_delivery',
    'delivered': 'delivered',
    'cancelled': 'cancelled', 'canceled': 'cancelled',
    'failed-collection': 'exception', 'failed-delivery': 'exception',
    'returned': 'exception',
}


def normalize_status(raw):
    if not raw:
        return 'created'
    return STATUS_MAP.get(str(raw).strip().lower().replace('_', '-'), 'in_transit')


class Shipment(models.Model):
    client = models.ForeignKey('quotes.Client', on_delete=models.PROTECT, related_name='shipments')
    # Set when the shipment originated in our portal; null for API-origin.
    booking = models.OneToOneField('finance.Booking', null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name='shipment_record')
    origin = models.CharField(max_length=20, choices=ORIGINS, default='portal')
    source_store = models.CharField(max_length=120, blank=True)

    # Cross-system identity (also indexed in finance.BookingIdentifier when there
    # is a booking). These are what the ShipLogic webhook arrives keyed by.
    consignment_id = models.CharField(max_length=64, blank=True, db_index=True)   # ShipLogic shipment_id
    tracking_number = models.CharField(max_length=64, blank=True, db_index=True)  # short_tracking_reference / waybill
    custom_tracking_reference = models.CharField(max_length=64, blank=True, db_index=True)
    customer_reference = models.CharField(max_length=120, blank=True, db_index=True)

    status_raw = models.CharField(max_length=60, blank=True)
    stage = models.CharField(max_length=20, choices=STAGE, default='created', db_index=True)
    courier_service = models.CharField(max_length=40, blank=True)
    shipping_cost_cents = models.BigIntegerField(default=0)

    collection_summary = models.CharField(max_length=255, blank=True)
    delivery_summary = models.CharField(max_length=255, blank=True)
    recipient_name = models.CharField(max_length=160, blank=True)

    estimated_collection = models.DateTimeField(null=True, blank=True)
    estimated_delivery = models.DateTimeField(null=True, blank=True)
    actual_delivery = models.DateTimeField(null=True, blank=True)

    # Latest live driver fix (from the route planner feed; updated out of band).
    driver_lat = models.FloatField(null=True, blank=True)
    driver_lng = models.FloatField(null=True, blank=True)
    driver_eta = models.DateTimeField(null=True, blank=True)
    driver_name = models.CharField(max_length=80, blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['client', 'stage', 'created_at'])]

    def __str__(self):
        return f"Shipment({self.tracking_number or self.consignment_id or self.pk}, {self.stage})"


class TrackingEvent(models.Model):
    """Append-only per-shipment event log, deduped on the source's event id so a
    redelivered webhook never double-records."""
    shipment = models.ForeignKey(Shipment, on_delete=models.CASCADE, related_name='events')
    external_id = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=60)
    message = models.CharField(max_length=255, blank=True)
    location = models.CharField(max_length=160, blank=True)
    source = models.CharField(max_length=40, blank=True)
    occurred_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-occurred_at', '-id']
        constraints = [
            models.UniqueConstraint(fields=['shipment', 'external_id'],
                                    condition=models.Q(external_id__gt=''),
                                    name='uniq_event_per_shipment_external'),
        ]
