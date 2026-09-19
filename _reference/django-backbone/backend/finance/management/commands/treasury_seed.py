from django.core.management.base import BaseCommand

from backend.finance.treasury.seed import seed_treasury


class Command(BaseCommand):
    help = "Seed treasury wallets, obligations and reserve targets (idempotent)."

    def handle(self, *args, **opts):
        created = seed_treasury()
        new = sum(1 for _, c in created if c)
        self.stdout.write(self.style.SUCCESS(
            f"Treasury seeded. {new} new wallet(s), {len(created)} total."))
