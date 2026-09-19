from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from decimal import Decimal
import secrets


class SiteSettings(models.Model):
    company_name = models.CharField(max_length=100, default='Delicate Courier Logistics')
    currency = models.CharField(max_length=3, default='ZAR')
    language = models.CharField(max_length=10, default='en')
    timezone = models.CharField(max_length=50, default='Africa/Johannesburg')
    email_quotes = models.BooleanField(default=True)
    sms_updates = models.BooleanField(default=False)
    webhook_url = models.URLField(blank=True, null=True)
    markup_percent = models.DecimalField(max_digits=5, decimal_places=2, default=15)
    min_delivery_fee = models.DecimalField(max_digits=10, decimal_places=2, default=150)
    fuel_surcharge = models.DecimalField(max_digits=5, decimal_places=2, default=4.5)
    google_maps_key = models.CharField(max_length=100, blank=True, default='')
    session_timeout = models.PositiveIntegerField(default=30)
    allowed_ips = models.CharField(max_length=200, blank=True, default='')

    class Meta:
        verbose_name_plural = "Site settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, created = cls.objects.get_or_create(pk=1)
        return obj


class UserProfile(models.Model):
    ROLE_CHOICES = [
        ('admin', 'Admin'),
        ('dispatcher', 'Dispatcher'),
        ('finance', 'Finance'),
        ('viewer', 'Viewer'),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='viewer')
    avatar_url = models.URLField(blank=True, null=True)
    phone = models.CharField(max_length=20, blank=True)

    def __str__(self):
        return f"{self.user.username} - {self.get_role_display()}"


class Quote(models.Model):
    STATUS_CHOICES = [
        ('accepted', 'Accepted'),
        ('pending', 'Pending'),
        ('draft', 'Draft'),
    ]

    # Route & pricing
    depot_address = models.TextField()
    bakery_address = models.TextField()
    end_depot_address = models.TextField()
    depot_to_bakery_km = models.DecimalField(max_digits=10, decimal_places=2)
    bakery_to_first_customer_km = models.DecimalField(max_digits=10, decimal_places=2)
    margin_percent = models.DecimalField(max_digits=5, decimal_places=2)
    total_distance_km = models.DecimalField(max_digits=10, decimal_places=2)
    cogs = models.DecimalField(max_digits=10, decimal_places=2)
    revenue = models.DecimalField(max_digits=10, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')

    quote_number = models.CharField(max_length=20, blank=True, null=True)
    tracking_number = models.CharField(max_length=30, blank=True, null=True)
    total_weight_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    pickup_coords_lat = models.DecimalField(max_digits=10, decimal_places=8, blank=True, null=True)
    pickup_coords_lng = models.DecimalField(max_digits=10, decimal_places=8, blank=True, null=True)

    # Contact details
    sender_name = models.CharField(max_length=255, blank=True, null=True)
    sender_email = models.EmailField(blank=True, null=True)
    sender_phone = models.CharField(max_length=20, blank=True, null=True)
    recipient_name = models.CharField(max_length=255, blank=True, null=True)
    recipient_email = models.EmailField(blank=True, null=True)
    recipient_phone = models.CharField(max_length=20, blank=True, null=True)

    # Special requests
    liability_cover = models.BooleanField(default=False)
    early_collection = models.BooleanField(default=False)
    signature_on_delivery = models.BooleanField(default=False)
    wedding_venue = models.BooleanField(default=False)
    special_instructions = models.TextField(blank=True, null=True)
    delivery_directions = models.TextField(blank=True, null=True)


    # Dates
    quote_expiry_date = models.DateTimeField(blank=True, null=True)

    # Parcels (store list of parcel objects)
    parcels = models.JSONField(default=list, blank=True, null=True)

    # Which rate card produced this quote, and (if generated via a client link) which link.
    rate_card = models.ForeignKey('RateCard', null=True, blank=True, on_delete=models.SET_NULL, related_name='quotes')
    client_link = models.ForeignKey('ClientQuoteLink', null=True, blank=True, on_delete=models.SET_NULL, related_name='quotes')


    def __str__(self):
        return f"Quote #{self.id} - {self.depot_address[:30]}..."

    @property
    def customer_name(self):
        first_customer = self.customers.first()
        return first_customer.address[:30] if first_customer else "—"


class Customer(models.Model):
    quote = models.ForeignKey(Quote, related_name='customers', on_delete=models.CASCADE)

    # Friendly name for the dropoff (example "Dropoff 1", company name and more)
    name = models.CharField(max_length=255, blank=True, null=True)

    address = models.TextField()
    distance_from_previous_km = models.DecimalField(max_digits=10, decimal_places=2)
    order = models.PositiveIntegerField()
    coords_lat = models.DecimalField(max_digits=10, decimal_places=8, blank=True, null=True)
    coords_lng = models.DecimalField(max_digits=10, decimal_places=8, blank=True, null=True)


    class Meta:
        ordering = ['order']

    def __str__(self):
        return f"Customer {self.order} - {self.address[:30]}..."


class Driver(models.Model):
    name = models.CharField(max_length=100)
    initials = models.CharField(max_length=10, blank=True)
    avatar_url = models.URLField(blank=True, null=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Vehicle(models.Model):
    VEHICLE_TYPES = [
        ('truck', 'Truck'),
        ('van', 'Van'),
        ('motorcycle', 'Motorcycle'),
        ('bakkie', 'Bakkie'),
    ]
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('maintenance', 'Maintenance'),
        ('standby', 'Standby'),
        ('inactive', 'Inactive'),
    ]

    vehicle_id = models.CharField(max_length=20, unique=True)
    license_plate = models.CharField(max_length=20)
    type = models.CharField(max_length=20, choices=VEHICLE_TYPES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    model_name = models.CharField(max_length=100)
    last_service = models.DateField(null=True, blank=True)
    driver = models.ForeignKey(Driver, null=True, blank=True, on_delete=models.SET_NULL, related_name='vehicles')

    class Meta:
        ordering = ['vehicle_id']

    def __str__(self):
        return f"{self.vehicle_id} - {self.license_plate}"


class Client(models.Model):
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('vip', 'VIP'),
    ]

    client_id = models.CharField(max_length=20, unique=True, blank=True)
    name = models.CharField(max_length=100)
    email = models.EmailField()
    phone = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    loyalty = models.BooleanField(default=False)
    joined_date = models.DateField(auto_now_add=True)
    total_spent = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    initials = models.CharField(max_length=10, blank=True)
    quote_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['-joined_date']

    def save(self, *args, **kwargs):
        if not self.initials and self.name:
            parts = self.name.split()
            self.initials = ''.join([p[0].upper() for p in parts[:2]])
        if not self.client_id:
            super().save(*args, **kwargs)
            if self.client_id is None or self.client_id == '':
                self.client_id = f"CL-{self.id:05d}"
                super().save(*args, **kwargs)
        else:
            super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.client_id} - {self.name}"


class RateCard(models.Model):
    """A named set of pricing levers. One card is the default (used by the public
    quote generator); other cards are attached to specific clients via ClientQuoteLink."""
    name = models.CharField(max_length=100, unique=True)
    cost_per_km = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('1.70'))
    margin_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('55.00'),
        help_text="Gross margin as a percentage. 55 means 55%.")
    fuel_surcharge_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('0.00'),
        help_text="Added on top of the base price, as a percentage. 0 = none.")
    min_delivery_fee = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0.00'),
        help_text="Price floor. The quote never drops below this. 0 = no floor.")
    is_default = models.BooleanField(
        default=False,
        help_text="The card used by the public quote generator and any link without an active card.")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_default', 'name']

    @property
    def margin_fraction(self):
        return self.margin_percent / Decimal('100')

    def save(self, *args, **kwargs):
        # Only ever one default card.
        if self.is_default:
            RateCard.objects.exclude(pk=self.pk).update(is_default=False)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name}{' (default)' if self.is_default else ''}"


class ClientQuoteLink(models.Model):
    """A unique, shareable link that lets one client self-generate quotes on their own rate card."""
    token = models.CharField(max_length=64, unique=True, blank=True, db_index=True)
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='quote_links')
    rate_card = models.ForeignKey(RateCard, on_delete=models.PROTECT, related_name='links')
    label = models.CharField(max_length=120, blank=True,
        help_text="Internal note, e.g. 'Honey Bee Baker daily quotes'.")
    # Pre-configured collection point. When set, the client only enters a delivery address.
    collection_name = models.CharField(max_length=120, blank=True, default='Pickup',
        help_text="Label for the collection point, e.g. the bakery name.")
    collection_address = models.TextField(blank=True,
        help_text="Pre-set collection address. Leave blank to let the client enter it themselves.")
    collection_lat = models.DecimalField(max_digits=11, decimal_places=8, null=True, blank=True,
        help_text="Auto-filled from the address on save; can be set manually.")
    collection_lng = models.DecimalField(max_digits=11, decimal_places=8, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    expires_at = models.DateTimeField(null=True, blank=True,
        help_text="Optional. Leave blank for a permanent link.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.token:
            self.token = secrets.token_urlsafe(24)
        super().save(*args, **kwargs)

    @property
    def is_valid(self):
        if not self.is_active:
            return False
        if self.expires_at and self.expires_at < timezone.now():
            return False
        return True

    @property
    def has_preset_collection(self):
        return bool(self.collection_address and self.collection_lat is not None and self.collection_lng is not None)

    def __str__(self):
        return f"{self.client.name} -> {self.rate_card.name}"
