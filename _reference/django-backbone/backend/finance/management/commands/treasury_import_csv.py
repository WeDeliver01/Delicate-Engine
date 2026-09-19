from django.core.management.base import BaseCommand

from backend.finance.treasury import analytics


class Command(BaseCommand):
    help = "Read a ShipLogic bookings CSV, print revenue analytics and recommended rules."

    def add_arguments(self, parser):
        parser.add_argument('path')
        parser.add_argument('--write-rules', action='store_true',
                            help="Persist the recommended AllocationRule rows.")

    def handle(self, *args, **opts):
        revs, span = analytics.revenues_from_csv(opts['path'])
        a = analytics.revenue_analytics(revs, span)
        r = lambda c: f"R{c/100:,.2f}"
        self.stdout.write(f"Bookings: {a['bookings']}  Span: {a['span_days']} days")
        self.stdout.write(f"Total revenue: {r(a['total_revenue_cents'])}  Avg booking: {r(a['avg_booking_cents'])}")
        self.stdout.write(f"Revenue / month: {r(a['revenue_per_month_cents'])}")
        self.stdout.write(f"CM rate: {a['contribution_margin_rate']:.0%}  Monthly CM: {r(a['monthly_contribution_margin_cents'])}")
        if opts['write_rules']:
            plan = analytics.recommend_rules(a['monthly_contribution_margin_cents'])
            self.stdout.write(self.style.SUCCESS(
                f"Wrote {len(plan['plan'])} rules. Coverage ratio {plan['coverage_ratio']}."))
