"""
Tests for the finance event-backbone: money, gate, ledger, outbox, idempotency,
soft-retry, and the end-to-end fund -> book -> dispatch flow.
"""
from unittest import mock

from django.test import TestCase, override_settings

from backend.quotes.models import Client
from . import services, events
from .money import to_cents, to_rands
from .models import (Wallet, LedgerEntry, TopUp, Booking, OutboxMessage,
                     ShipLogicShipment, ShipLogicBillingTxn)
from . import outbox


def make_client(name='Honey Bee Baker'):
    # Use instance.save() (not .create) to avoid a latent force_insert
    # double-save in the existing Client.save() override.
    c = Client(name=name, email='melissa@example.com')
    c.save()
    return c


class MoneyTests(TestCase):
    def test_round_trip_and_half_up(self):
        self.assertEqual(to_cents('150.00'), 15000)
        self.assertEqual(to_cents('0.005'), 1)          # half up
        self.assertEqual(to_cents(285), 28500)
        self.assertEqual(str(to_rands(28500)), '285.00')


class LedgerTests(TestCase):
    def test_append_only(self):
        c = make_client()
        w = services.get_or_create_wallet(c)
        e = LedgerEntry.objects.create(wallet=w, kind='adjustment', amount_cents=100,
                                       balance_after_cents=100, reference='x')
        with self.assertRaises(ValueError):
            e.amount_cents = 5
            e.save()
        with self.assertRaises(ValueError):
            e.delete()


class TopUpTests(TestCase):
    def test_confirm_credits_and_emits_and_is_idempotent(self):
        c = make_client()
        t = TopUp.objects.create(client=c, amount_cents=50000, provider_reference='ref1')
        services.confirm_topup(t)
        w = Wallet.objects.get(client=c)
        self.assertEqual(w.balance_cents, 50000)
        self.assertEqual(LedgerEntry.objects.filter(wallet=w).count(), 1)
        # one engine event + one shiplogic payment message
        self.assertTrue(OutboxMessage.objects.filter(topic='engine.event',
                        event_type=events.TOPUP_CONFIRMED).exists())
        self.assertTrue(OutboxMessage.objects.filter(topic='shiplogic.billing',
                        event_type='topup.payment').exists())
        # idempotent: confirming again does not double-credit
        services.confirm_topup(t)
        self.assertEqual(Wallet.objects.get(client=c).balance_cents, 50000)
        self.assertEqual(LedgerEntry.objects.filter(wallet=w).count(), 1)


class BookingGateTests(TestCase):
    def test_rejects_insufficient_funds(self):
        c = make_client()
        services.get_or_create_wallet(c)  # balance 0
        with self.assertRaises(services.InsufficientFunds):
            services.charge_booking(c, price_cents=28500, reference='BK1')
        b = Booking.objects.get(reference='BK1')
        self.assertEqual(b.status, 'rejected_insufficient_funds')
        self.assertEqual(LedgerEntry.objects.count(), 0)  # nothing charged

    def test_charges_when_funded_and_queues_dispatch(self):
        c = make_client()
        t = TopUp.objects.create(client=c, amount_cents=100000, provider_reference='r')
        services.confirm_topup(t)
        b = services.charge_booking(c, price_cents=28500, reference='BK2')
        self.assertEqual(b.status, 'charged')
        w = Wallet.objects.get(client=c)
        self.assertEqual(w.balance_cents, 100000 - 28500)
        self.assertTrue(OutboxMessage.objects.filter(event_type=events.BOOKING_CHARGED).exists())
        self.assertTrue(OutboxMessage.objects.filter(topic='shiplogic.shipment').exists())

    def test_booking_reference_is_idempotent(self):
        c = make_client()
        services.confirm_topup(TopUp.objects.create(client=c, amount_cents=100000,
                                                    provider_reference='r'))
        b1 = services.charge_booking(c, 28500, 'BK3')
        b2 = services.charge_booking(c, 28500, 'BK3')
        self.assertEqual(b1.pk, b2.pk)
        self.assertEqual(Wallet.objects.get(client=c).balance_cents, 100000 - 28500)


class ReversalTests(TestCase):
    def test_reversal_credits_back_and_is_idempotent(self):
        c = make_client()
        services.confirm_topup(TopUp.objects.create(client=c, amount_cents=100000,
                                                    provider_reference='r'))
        services.charge_booking(c, 28500, 'BK4')
        services.reverse_booking('BK4', reason='client cancelled')
        self.assertEqual(Wallet.objects.get(client=c).balance_cents, 100000)
        services.reverse_booking('BK4')  # idempotent
        self.assertEqual(Wallet.objects.get(client=c).balance_cents, 100000)


class OutboxTests(TestCase):
    def test_enqueue_is_idempotent(self):
        events.enqueue_engine_event('x.y', 'key-1', {'a': 1})
        events.enqueue_engine_event('x.y', 'key-1', {'a': 2})
        self.assertEqual(OutboxMessage.objects.filter(idempotency_key='key-1').count(), 1)

    def test_engine_event_soft_retries_when_unconfigured(self):
        # ENGINE_INGEST_URL is '' by default -> soft retry, never dead-letter.
        events.enqueue_engine_event('x.y', 'key-soft', {'a': 1})
        stats = outbox.dispatch_due()
        self.assertEqual(stats['soft_retry'], 1)
        m = OutboxMessage.objects.get(idempotency_key='key-soft')
        self.assertEqual(m.status, 'pending')
        self.assertEqual(m.attempts, 0)
        self.assertTrue(m.last_error.startswith('soft:'))

    @override_settings(ENGINE_INGEST_URL='https://engine.test/ingest',
                       ENGINE_HMAC_SECRET='s3cret')
    def test_engine_event_sent_when_configured(self):
        events.enqueue_engine_event('x.y', 'key-ok', {'a': 1})
        with mock.patch('backend.finance.clients.engine.requests.post') as post:
            post.return_value = mock.Mock(status_code=200, json=lambda: {'ok': True})
            stats = outbox.dispatch_due()
        self.assertEqual(stats['sent'], 1)
        self.assertEqual(OutboxMessage.objects.get(idempotency_key='key-ok').status, 'sent')
        # signed headers were attached
        _, kwargs = post.call_args
        self.assertIn('X-Delicate-Signature', kwargs['headers'])
        self.assertEqual(kwargs['headers']['Idempotency-Key'], 'key-ok')


class EndToEndDispatchTests(TestCase):
    @override_settings(ENGINE_INGEST_URL='https://engine.test/ingest',
                       SHIPLOGIC_TOKEN='tok', SHIPLOGIC_PROVIDER_ID='10')
    def test_fund_book_dispatch_full_chain(self):
        c = make_client()
        # map the client's ShipLogic account
        services.confirm_topup(TopUp.objects.create(client=c, amount_cents=100000,
                                                    provider_reference='r'))
        w = Wallet.objects.get(client=c)
        w.shiplogic_account_id = '654279'
        w.save()
        services.charge_booking(c, 28500, 'BK5',
                                collection={'address': {}, 'contact': {}},
                                delivery={'address': {}, 'contact': {}},
                                parcels=[{'submitted_weight_kg': 2}])

        with mock.patch('backend.finance.clients.engine.requests.post') as epost, \
             mock.patch('backend.finance.clients.shiplogic.requests.post') as spost:
            epost.return_value = mock.Mock(status_code=202, json=lambda: {})

            def sl_post(url, *a, **k):
                if url.endswith('/shipments'):
                    return mock.Mock(status_code=201, json=lambda: {
                        'id': 123, 'short_tracking_reference': 'WAYB1'})
                return mock.Mock(status_code=201, json=lambda: {'id': 999})
            spost.side_effect = sl_post
            # Drain repeatedly: shipment handler chains a billing message.
            for _ in range(5):
                outbox.dispatch_due()

        booking = Booking.objects.get(reference='BK5')
        self.assertEqual(booking.status, 'dispatched')
        ship = ShipLogicShipment.objects.get(booking=booking)
        self.assertEqual(ship.waybill, 'WAYB1')
        debit = ShipLogicBillingTxn.objects.get(booking=booking, kind='admin-debit')
        self.assertEqual(debit.status, 'posted')
        self.assertEqual(debit.amount_cents, 28500)
        # everything delivered, nothing stuck pending
        self.assertEqual(OutboxMessage.objects.filter(status='pending').count(), 0)
        self.assertEqual(OutboxMessage.objects.filter(status='failed').count(), 0)

    @override_settings(SHIPLOGIC_TOKEN='tok', SHIPLOGIC_PROVIDER_ID='10')
    def test_shipment_soft_retries_without_account_mapping(self):
        c = make_client()
        services.confirm_topup(TopUp.objects.create(client=c, amount_cents=100000,
                                                    provider_reference='r'))
        services.charge_booking(c, 28500, 'BK6')  # wallet has no shiplogic_account_id
        stats = outbox.dispatch_due()
        # shipment message soft-retries (no account id), nothing dead-lettered
        self.assertEqual(OutboxMessage.objects.filter(status='failed').count(), 0)
        msg = OutboxMessage.objects.get(topic='shiplogic.shipment')
        self.assertEqual(msg.status, 'pending')
