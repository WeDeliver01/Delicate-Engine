"""
Tests for booking capacity: availability, atomic consumption, auto-close,
manual close, capacity override, blackout, cutoff, and the finance integration
(slot + wallet gates together, with reversal releasing capacity).
"""
from datetime import date, timedelta

from django.test import TestCase
from django.utils import timezone

from backend.quotes.models import Client
from backend.finance import services as fin
from backend.finance.models import Booking, TopUp
from . import services as sched
from .models import SlotPolicy, DeliverySlot, BlackoutDate


def make_client(name='Honey Bee Baker'):
    c = Client(name=name, email='melissa@example.com')
    c.save()
    return c


def fund(client, cents):
    fin.confirm_topup(TopUp.objects.create(
        client=client, amount_cents=cents, provider_reference=f'r{client.id}'))


def operating_date():
    d = date.today() + timedelta(days=2)
    while d.weekday() > 4:          # Mon-Fri only under the default policy
        d += timedelta(days=1)
    return d


class AvailabilityTests(TestCase):
    def test_lists_operating_windows_and_skips_weekends(self):
        SlotPolicy.get_active()
        d = operating_date()
        slots = sched.get_availability(d, d)
        self.assertEqual(len(slots), 2)                 # am + pm
        self.assertTrue(all(s['bookable'] for s in slots))
        # a Saturday yields nothing
        sat = d
        while sat.weekday() != 5:
            sat += timedelta(days=1)
        self.assertEqual(sched.get_availability(sat, sat), [])


class CapacityConsumeTests(TestCase):
    def test_booking_consumes_and_auto_closes(self):
        c = make_client(); fund(c, 1_000_00)
        d = operating_date()
        sched.set_slot_capacity(d, 'am', 1)             # tighten to a single space
        fin.charge_booking(c, 100_00, 'BK-A', slot_date=d, slot_window='am')
        slot = DeliverySlot.objects.get(date=d, window_key='am')
        self.assertEqual(slot.booked_count, 1)
        self.assertEqual(slot.status, 'closed_full')    # auto-closed
        # next booking on the same slot is rejected, and nothing is charged
        before = fin.get_or_create_wallet(c).balance_cents
        with self.assertRaises(sched.SlotUnavailable):
            fin.charge_booking(c, 100_00, 'BK-B', slot_date=d, slot_window='am')
        self.assertEqual(fin.get_or_create_wallet(c).balance_cents, before)
        self.assertEqual(Booking.objects.get(reference='BK-B').status,
                         'rejected_slot_unavailable')

    def test_insufficient_funds_does_not_consume_capacity(self):
        c = make_client()                                # unfunded
        d = operating_date()
        with self.assertRaises(fin.InsufficientFunds):
            fin.charge_booking(c, 100_00, 'BK-C', slot_date=d, slot_window='am')
        slot = DeliverySlot.objects.get(date=d, window_key='am')
        self.assertEqual(slot.booked_count, 0)           # capacity untouched
        self.assertEqual(Booking.objects.get(reference='BK-C').status,
                         'rejected_insufficient_funds')

    def test_reversal_releases_capacity(self):
        c = make_client(); fund(c, 1_000_00)
        d = operating_date()
        sched.set_slot_capacity(d, 'am', 1)
        fin.charge_booking(c, 100_00, 'BK-D', slot_date=d, slot_window='am')
        self.assertEqual(DeliverySlot.objects.get(date=d, window_key='am').status,
                         'closed_full')
        fin.reverse_booking('BK-D', reason='client cancelled')
        slot = DeliverySlot.objects.get(date=d, window_key='am')
        self.assertEqual(slot.booked_count, 0)
        self.assertEqual(slot.status, 'open')            # reopened


class ManualControlsTests(TestCase):
    def test_manual_close_blocks_booking(self):
        c = make_client(); fund(c, 1_000_00)
        d = operating_date()
        sched.set_slot_closed(d, 'am', True)
        with self.assertRaises(sched.SlotUnavailable):
            fin.charge_booking(c, 100_00, 'BK-E', slot_date=d, slot_window='am')

    def test_capacity_override_reopens_full_slot(self):
        c = make_client(); fund(c, 1_000_00)
        d = operating_date()
        sched.set_slot_capacity(d, 'am', 1)
        fin.charge_booking(c, 100_00, 'BK-F', slot_date=d, slot_window='am')
        self.assertEqual(DeliverySlot.objects.get(date=d, window_key='am').status,
                         'closed_full')
        sched.set_slot_capacity(d, 'am', 5)              # raise capacity
        self.assertEqual(DeliverySlot.objects.get(date=d, window_key='am').status,
                         'open')

    def test_blackout_blocks_booking(self):
        c = make_client(); fund(c, 1_000_00)
        d = operating_date()
        BlackoutDate.objects.create(date=d, reason='public holiday')
        with self.assertRaises(sched.SlotUnavailable):
            fin.charge_booking(c, 100_00, 'BK-G', slot_date=d, slot_window='am')


class CutoffTests(TestCase):
    def test_past_cutoff_not_bookable(self):
        # a slot in the past is never bookable
        past = date.today() - timedelta(days=1)
        slot = DeliverySlot.objects.create(
            date=past, window_key='am', label='m', start_time='08:00',
            end_time='12:00', capacity=10, status='open')
        self.assertFalse(slot.is_bookable())
        self.assertEqual(slot.closed_reason(), 'cutoff_passed')
