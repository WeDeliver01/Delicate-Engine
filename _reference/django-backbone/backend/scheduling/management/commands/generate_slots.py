"""
Optionally pre-materialize slots for a horizon so they appear in the admin and
availability immediately (they are also created lazily on first view/booking).

    python manage.py generate_slots --days 21
"""
from datetime import date, timedelta

from django.core.management.base import BaseCommand

from backend.scheduling.models import SlotPolicy
from backend.scheduling.services import materialize_slot


class Command(BaseCommand):
    help = "Pre-create delivery slots for the next N operating days."

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, default=14)

    def handle(self, *args, **opts):
        policy = SlotPolicy.get_active()
        made = 0
        d = date.today()
        for _ in range(opts['days']):
            if policy.operates_on(d):
                for w in policy.windows:
                    materialize_slot(d, w['key'], policy)
                    made += 1
            d += timedelta(days=1)
        self.stdout.write(self.style.SUCCESS(f"materialized {made} slots"))
