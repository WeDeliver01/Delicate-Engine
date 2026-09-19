"""Treasury allocation engine: cost stage, urgency-weighted obligation funding,
reserve cascade, idempotency, reversal, recommender, forecast, dashboard."""
import time

import jwt
from django.test import TestCase, override_settings

from backend.quotes.models import Client
from backend.finance.models import Booking, AllocationWallet, AllocationTransaction, AllocationRule
from backend.finance.treasury.seed import seed_treasury
from backend.finance.treasury import services as tre
from backend.finance.treasury import analytics

SECRET = 'treasury-secret-key-at-least-32bytes-long'
OBLIG_TOTAL = 4686516  # R46,865.16


def boss():
    return jwt.encode({'sub': 'boss', 'aud': 'authenticated', 'app_role': 'SuperAdmin',
                       'iat': int(time.time()), 'exp': int(time.time()) + 3600},
                      SECRET, algorithm='HS256')


def a_client():
    c = Client(name='Baked By Nataleen', email='s@b.co.za'); c.save()
    return c


def booking(client, cents, ref):
    return Booking.objects.create(client=client, price_cents=cents, status='charged', reference=ref)


class CostStageTests(TestCase):
    def test_contribution_margin_formula(self):
        c = tre.compute_costs(30000)  # R300
        self.assertEqual(c['fuel_cents'], 4200)      # 14%
        self.assertEqual(c['driver_cents'], 9600)    # 32%
        self.assertEqual(c['contribution_margin_cents'], 16200)  # remainder only


class AllocationTests(TestCase):
    def setUp(self):
        seed_treasury()
        self.c = a_client()

    def _sum(self, booking, kinds):
        return AllocationTransaction.objects.filter(
            booking=booking, kind__in=kinds).aggregate(
            s=__import__('django').db.models.Sum('amount_cents'))['s'] or 0

    def test_only_margin_is_allocated_and_balances(self):
        b = booking(self.c, 30000, 'CM-1')
        tre.allocate_for_booking(b)
        # fuel + driver recorded as cost, not allocated to obligations
        self.assertEqual(AllocationWallet.objects.get(slug='cost-fuel').balance_cents, 4200)
        self.assertEqual(AllocationWallet.objects.get(slug='cost-driver').balance_cents, 9600)
        # all 16200 of CM goes to obligations (margin is scarce vs R46,865)
        exp = self._sum(b, ['allocation'])
        self.assertEqual(exp, 16200)
        # nothing reached reserves or retained
        self.assertEqual(AllocationWallet.objects.get(slug='retained-earnings').balance_cents, 0)
        self.assertEqual(AllocationWallet.objects.get(slug='emergency-reserve').balance_cents, 0)

    def test_double_entry_sum_equals_margin(self):
        b = booking(self.c, 30000, 'CM-2')
        tre.allocate_for_booking(b)
        moved = self._sum(b, ['allocation', 'overflow'])
        self.assertEqual(moved, 16200)  # exactly the contribution margin

    def test_idempotent(self):
        b = booking(self.c, 30000, 'CM-3')
        tre.allocate_for_booking(b)
        n1 = AllocationTransaction.objects.count()
        tre.allocate_for_booking(b)  # re-run
        self.assertEqual(AllocationTransaction.objects.count(), n1)

    def test_surplus_cascades_to_reserves_when_obligations_full(self):
        b = booking(self.c, 100_000_00, 'CM-4')  # R100,000 booking -> CM R54,000 > obligations
        tre.allocate_for_booking(b)
        # every obligation fully funded
        exp = self._sum(b, ['allocation'])
        self.assertEqual(exp, OBLIG_TOTAL)
        # surplus went to reserves (emergency first, then vehicle replacement)
        self.assertEqual(AllocationWallet.objects.get(slug='emergency-reserve').balance_cents, 500000)
        self.assertGreater(AllocationWallet.objects.get(slug='vehicle-replacement').balance_cents, 0)
        cm = tre.compute_costs(100_000_00)['contribution_margin_cents']
        self.assertEqual(self._sum(b, ['allocation', 'overflow']), cm)

    def test_reversal_unwinds_all_balances(self):
        b = booking(self.c, 30000, 'CM-5')
        tre.allocate_for_booking(b)
        tre.reverse_allocations(b)
        for slug in ('cost-fuel', 'cost-driver', 'vehicle-finance', 'payroll'):
            self.assertEqual(AllocationWallet.objects.get(slug=slug).balance_cents, 0)

    def test_urgency_weights_due_soon_higher(self):
        import datetime as dt
        soon = tre._urgency(dt.date.today().day, dt.date.today())   # due today
        far = tre._urgency((dt.date.today().day + 20), dt.date.today())
        self.assertGreaterEqual(soon, far)


class RecommenderTests(TestCase):
    def setUp(self):
        seed_treasury()

    def test_scarce_margin_splits_full_margin(self):
        plan = analytics.recommend_rules(1_600_000)  # well below obligations
        self.assertEqual(AllocationRule.objects.count(), 11)
        self.assertAlmostEqual(plan['expense_bps_total'], 10000, delta=5)  # ~100% of CM
        self.assertLess(plan['coverage_ratio'], 1)

    def test_forecast_reports_shortfall(self):
        fc = analytics.forecast(avg_daily_cm_cents=int(1_600_000 / 30.4))
        self.assertIn('projected_coverage', fc)
        self.assertGreater(fc['projected_shortfall_cents'], 0)


@override_settings(SUPABASE_JWT_SECRET=SECRET, SUPABASE_AUD='authenticated', APPEND_SLASH=False)
class DashboardTests(TestCase):
    def setUp(self):
        seed_treasury()

    def test_requires_super_admin(self):
        self.assertEqual(self.client.get('/api/admin/treasury/dashboard').status_code, 401)

    def test_returns_command_centre(self):
        r = self.client.get('/api/admin/treasury/dashboard', HTTP_AUTHORIZATION=f'Bearer {boss()}')
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body['obligations']['total_cents'], OBLIG_TOTAL)
        self.assertEqual(len(body['upcoming_debit_orders']), 11)
        self.assertIn('financial_health_score', body)


class IntegrationTests(TestCase):
    def setUp(self):
        seed_treasury()

    def test_charge_then_outbox_runs_allocation(self):
        from backend.finance import services as fin
        from backend.finance.models import TopUp
        from backend.finance.outbox import dispatch_due
        c = a_client()
        fin.confirm_topup(TopUp.objects.create(client=c, amount_cents=100000, provider_reference='r1'))
        fin.charge_booking(c, 30000, 'INT-1')
        dispatch_due(limit=50)  # runs the treasury.allocate handler
        b = Booking.objects.get(reference='INT-1')
        self.assertTrue(AllocationTransaction.objects.filter(booking=b, kind='allocation').exists())
