"""
Booking capacity and slots.

A SlotPolicy holds the rules (which weekdays operate, the time windows, the
default capacity per window, and the lead-time cutoff). DeliverySlots are the
concrete bookable instances for a given date and window; they are materialized
lazily from the policy the first time a date is viewed or booked.

Capacity is consumed atomically when a booking is placed (see scheduling.services
and finance.charge_booking). A slot auto-closes the moment it fills, and the
super admin can close or reopen any slot by hand. Clients read availability and
watch slots fill in real time.
"""
from datetime import datetime, timedelta

from django.db import models
from django.utils import timezone


class SlotPolicy(models.Model):
    """The rules that govern booking capacity. One active policy at a time."""
    name = models.CharField(max_length=50, unique=True, default='default')
    active = models.BooleanField(default=True)
    # Weekdays the courier operates. Monday=0 .. Sunday=6.
    operating_weekdays = models.JSONField(default=list)
    # Time windows, e.g.
    # [{"key":"am","label":"Morning","start":"08:00","end":"12:00","capacity":20}]
    windows = models.JSONField(default=list)
    default_capacity = models.PositiveIntegerField(default=20)
    # A slot stops accepting bookings this many minutes before it starts.
    lead_time_minutes = models.PositiveIntegerField(default=120)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"SlotPolicy({self.name}{'*' if self.active else ''})"

    @classmethod
    def get_active(cls):
        policy = cls.objects.filter(active=True).order_by('id').first()
        if policy is None:
            policy = cls.objects.create(
                name='default', active=True,
                operating_weekdays=[0, 1, 2, 3, 4],
                windows=[
                    {'key': 'am', 'label': 'Morning (08:00-12:00)',
                     'start': '08:00', 'end': '12:00', 'capacity': 20},
                    {'key': 'pm', 'label': 'Afternoon (12:00-16:00)',
                     'start': '12:00', 'end': '16:00', 'capacity': 15},
                ],
                default_capacity=20, lead_time_minutes=120)
        return policy

    def window(self, key):
        for w in self.windows:
            if w.get('key') == key:
                return w
        return None

    def operates_on(self, d):
        return d.weekday() in (self.operating_weekdays or [])


class BlackoutDate(models.Model):
    """A date the courier does not deliver (public holiday, stocktake, etc.).
    All slots on this date are unbookable regardless of capacity."""
    date = models.DateField(unique=True)
    reason = models.CharField(max_length=200, blank=True)

    def __str__(self):
        return f"Blackout({self.date})"


class DeliverySlot(models.Model):
    STATUS = [
        ('open', 'Open'),
        ('closed_full', 'Closed: at capacity'),
        ('closed_manual', 'Closed: manually'),
    ]
    date = models.DateField(db_index=True)
    window_key = models.CharField(max_length=20)
    label = models.CharField(max_length=80)
    start_time = models.TimeField()
    end_time = models.TimeField()
    capacity = models.PositiveIntegerField()
    booked_count = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=16, choices=STATUS, default='open')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['date', 'window_key'],
                                    name='uniq_slot_per_date_window'),
        ]
        ordering = ['date', 'start_time']
        indexes = [models.Index(fields=['date', 'status'])]

    def __str__(self):
        return f"Slot({self.date} {self.window_key} {self.booked_count}/{self.capacity})"

    @property
    def remaining(self):
        return max(0, self.capacity - self.booked_count)

    def cutoff(self):
        """The aware datetime after which this slot can no longer be booked."""
        policy = SlotPolicy.get_active()
        d = self.date
        if isinstance(d, str):
            d = datetime.strptime(d, '%Y-%m-%d').date()
        st = self.start_time
        if isinstance(st, str):
            st = datetime.strptime(st, '%H:%M').time()
        start_dt = datetime.combine(d, st)
        start_dt = timezone.make_aware(start_dt, timezone.get_current_timezone())
        return start_dt - timedelta(minutes=policy.lead_time_minutes)

    def is_bookable(self, now=None):
        now = now or timezone.now()
        if self.status != 'open' or self.remaining <= 0:
            return False
        if BlackoutDate.objects.filter(date=self.date).exists():
            return False
        return now < self.cutoff()

    def closed_reason(self, now=None):
        """Human-readable reason a slot is not bookable, for the client view."""
        now = now or timezone.now()
        if BlackoutDate.objects.filter(date=self.date).exists():
            return 'blackout'
        if self.status == 'closed_manual':
            return 'closed'
        if self.remaining <= 0 or self.status == 'closed_full':
            return 'full'
        if now >= self.cutoff():
            return 'cutoff_passed'
        return ''
