"""Book-from-quote: quote needs no contact, booking requires it; parcels and the
universal identity resolver wire up across systems."""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase

from backend.quotes.models import Client, Quote
from backend.finance import services as fin
from backend.finance.models import TopUp, Booking, Parcel
from backend.catalog.models import PackageType, ParcelCategory


def make_client():
    c = Client(name='Baked By Nataleen', email='sales@bakedbynataleen.co.za')
    c.save()
    return c


def make_quote(rev='313.83'):
    return Quote.objects.create(
        depot_address='d', bakery_address='b', end_depot_address='e',
        depot_to_bakery_km=Decimal('10'), bakery_to_first_customer_km=Decimal('5'),
        margin_percent=Decimal('55'), total_distance_km=Decimal('15'),
        cogs=Decimal('100'), revenue=Decimal(rev), status='accepted')


def fund(c, cents):
    fin.confirm_topup(TopUp.objects.create(client=c, amount_cents=cents,
                                           provider_reference=f'r{c.id}'))


CONTACTS = {
    'collection': {'contact': {'name': 'Nataleen', 'phone': '+27646536218'},
                   'address': {'street': '135 Erich Mayer'}},
    'delivery': {'contact': {'name': 'Khuthele', 'phone': '+27824855512'},
                 'address': {'street': 'Unit 102i'}},
}


class CatalogTests(TestCase):
    def test_seed_and_read(self):
        from django.core.management import call_command
        call_command('seed_catalog')
        self.assertTrue(PackageType.objects.filter(name='Platters Medium').exists())
        self.assertTrue(ParcelCategory.objects.filter(name='Freshly Prepared Platters').exists())


class BookFromQuoteTests(TestCase):
    def setUp(self):
        self.pkg = PackageType.objects.create(name='Platters Medium',
            default_length_cm=30, default_width_cm=30, default_height_cm=10, default_weight_kg=3)
        self.cat = ParcelCategory.objects.create(name='Freshly Prepared Platters', perishable=True)

    def test_quote_needs_no_contact_but_booking_requires_it(self):
        c = make_client(); fund(c, 1_000_00)
        q = make_quote()
        # missing contacts -> rejected before any charge
        with self.assertRaises(fin.MissingContactDetails) as ctx:
            fin.book_from_quote(c, q, collection={}, delivery={}, parcels=[])
        self.assertIn('collection_name', ctx.exception.missing)
        self.assertIn('delivery_phone', ctx.exception.missing)
        self.assertEqual(Booking.objects.count(), 0)      # nothing created

    def test_books_with_contacts_parcels_and_identifiers(self):
        c = make_client(); fund(c, 1_000_00)
        q = make_quote('313.83')
        parcels = [{'package_type_id': self.pkg.id, 'parcel_category_id': self.cat.id,
                    'length_cm': 30, 'width_cm': 30, 'height_cm': 10, 'weight_kg': 3,
                    'alt_tracking_ref': 'BBN-XYZ-1'}]
        b = fin.book_from_quote(c, q, collection=CONTACTS['collection'],
                                delivery=CONTACTS['delivery'], parcels=parcels,
                                customer_reference='PO-5567')
        self.assertEqual(b.status, 'charged')
        self.assertEqual(b.price_cents, 31383)
        self.assertEqual(fin.get_or_create_wallet(c).balance_cents, 1_000_00 - 31383)
        self.assertEqual(Parcel.objects.filter(booking=b).count(), 1)
        # every identity resolves back to the one booking
        self.assertEqual(Booking.resolve(b.reference).pk, b.pk)
        self.assertEqual(Booking.resolve('PO-5567').pk, b.pk)
        self.assertEqual(Booking.resolve('BBN-XYZ-1').pk, b.pk)
        # charged weight = max(actual 3, volumetric 30*30*10/5000=1.8) = 3
        self.assertEqual(Parcel.objects.get(booking=b).charged_weight_kg, Decimal('3'))

    def test_rate_breakdown_splits_base_and_fuel(self):
        q = make_quote('313.83')
        rb = fin.rate_breakdown(q, [{'length_cm': 30, 'width_cm': 30, 'height_cm': 10, 'weight_kg': 3}])
        self.assertEqual(rb['total_cents'], 31383)
        self.assertEqual(rb['charged_weight_kg'], '3.00')

    def test_liability_premium_added_when_configured(self):
        from django.test import override_settings
        c = make_client(); fund(c, 1_000_00)
        q = make_quote('100.00')
        with override_settings(LIABILITY_RATE_PERCENT='2'):
            b = fin.book_from_quote(c, q, collection=CONTACTS['collection'],
                                    delivery=CONTACTS['delivery'], parcels=[],
                                    liability_cover=True, declared_value_cents=50000)
        # 100.00 + 2% of 500.00 = 100 + 10 = 110.00
        self.assertEqual(b.price_cents, 11000)
