"""Unified shipment view: portal projection, cross-source ingest, ShipLogic
tracking webhook resolving by any identity, and the client-scoped list."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from backend.quotes.models import Client, Quote
from backend.finance import services as fin
from backend.finance.models import TopUp, Wallet
from backend.catalog.models import PackageType, ParcelCategory
from . import services as trk
from .models import Shipment, TrackingEvent, normalize_status

CONTACTS = {'collection': {'contact': {'name': 'N', 'phone': '+27640000000'}, 'address': {'street': '135 Erich Mayer'}},
            'delivery': {'contact': {'name': 'K', 'phone': '+27820000000'}, 'address': {'street': 'Unit 102i'}}}


def client_with_funds(acct='654279'):
    c = Client(name='Baked By Nataleen', email='s@b.co.za'); c.save()
    fin.confirm_topup(TopUp.objects.create(client=c, amount_cents=1_000_00, provider_reference=f'r{c.id}'))
    w = Wallet.objects.get(client=c); w.shiplogic_account_id = acct; w.save()
    return c


def a_quote():
    return Quote.objects.create(depot_address='d', bakery_address='b', end_depot_address='e',
        depot_to_bakery_km=Decimal('10'), bakery_to_first_customer_km=Decimal('5'),
        margin_percent=Decimal('55'), total_distance_km=Decimal('15'), cogs=Decimal('100'),
        revenue=Decimal('313.83'), status='accepted')


class StatusMapTests(TestCase):
    def test_normalization(self):
        self.assertEqual(normalize_status('Collection assigned'), 'created')
        self.assertEqual(normalize_status('out-for-delivery'), 'out_for_delivery')
        self.assertEqual(normalize_status('delivered'), 'delivered')
        self.assertEqual(normalize_status('something-new'), 'in_transit')


class ProjectionTests(TestCase):
    def test_portal_booking_projects_into_shipment(self):
        c = client_with_funds()
        b = fin.book_from_quote(c, a_quote(), CONTACTS['collection'], CONTACTS['delivery'],
                                parcels=[{'length_cm': 30, 'width_cm': 30, 'height_cm': 10, 'weight_kg': 3}],
                                customer_reference='PO-9')
        s = Shipment.objects.get(booking=b)
        self.assertEqual(s.origin, 'portal')
        self.assertEqual(s.client_id, c.id)
        self.assertEqual(s.customer_reference, 'PO-9')


class CrossSourceTests(TestCase):
    def test_api_shipment_ingest_maps_to_client_by_account(self):
        c = client_with_funds(acct='777')
        s = trk.ingest_api_shipment(c, {
            'origin': 'woocommerce', 'source_store': 'bakedbynataleen.co.za',
            'consignment_id': '90001', 'tracking_number': 'WC123',
            'status': 'Collection assigned', 'recipient_name': 'A. Customer',
            'delivery_summary': '26 Avondale Crescent'})
        self.assertEqual(s.origin, 'woocommerce')
        self.assertEqual(s.stage, 'created')
        self.assertEqual(Shipment.objects.filter(client=c).count(), 1)


class TrackingWebhookTests(TestCase):
    def _booked(self):
        c = client_with_funds()
        b = fin.book_from_quote(c, a_quote(), CONTACTS['collection'], CONTACTS['delivery'],
                                parcels=[{'length_cm': 30, 'width_cm': 30, 'height_cm': 10, 'weight_kg': 3}])
        # simulate dispatch having set the waybill/consignment identities
        b.waybill = 'KSN2A9'; b.shiplogic_id = '55001'; b.save()
        b.attach_identifier('waybill', 'KSN2A9'); b.attach_identifier('shiplogic_id', '55001')
        s = trk.project_booking(b)
        return c, b, s

    def test_webhook_resolves_by_consignment_and_advances_stage(self):
        c, b, s = self._booked()
        out = trk.ingest_tracking({
            'shipment_id': 55001, 'short_tracking_reference': 'KSN2A9',
            'status': 'out-for-delivery',
            'tracking_events': [{'id': 9001, 'status': 'out-for-delivery',
                                 'message': 'On the way', 'location': 'Midrand', 'date': '2026-06-21T10:30:00Z'}]})
        self.assertEqual(out.pk, s.pk)
        s.refresh_from_db()
        self.assertEqual(s.stage, 'out_for_delivery')
        self.assertEqual(TrackingEvent.objects.filter(shipment=s).count(), 1)
        # redelivery is deduped on external id
        trk.ingest_tracking({'shipment_id': 55001, 'status': 'out-for-delivery',
                             'tracking_events': [{'id': 9001, 'status': 'out-for-delivery', 'date': '2026-06-21T10:30:00Z'}]})
        self.assertEqual(TrackingEvent.objects.filter(shipment=s).count(), 1)

    def test_webhook_resolves_by_custom_reference_when_only_that_is_known(self):
        c = client_with_funds()
        s = trk.ingest_api_shipment(c, {'tracking_number': 'WC9', 'custom_tracking_reference': 'CUST-XYZ'})
        out = trk.ingest_tracking({'shipment_id': 0, 'custom_tracking_reference': 'CUST-XYZ',
                                   'status': 'delivered'})
        self.assertIsNotNone(out)
        s.refresh_from_db()
        self.assertEqual(s.stage, 'delivered')

    def test_unknown_shipment_returns_none(self):
        self.assertIsNone(trk.ingest_tracking({'shipment_id': 1, 'status': 'delivered'}))
