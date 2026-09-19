"""
Reconciliation + recovery.

  * Re-arms dead-lettered (failed) messages for another attempt.
  * Reports outbox health and any wallet whose ledger sum does not match its
    balance (local integrity), which is the first signal of drift before you
    even compare against the engine.

    python manage.py reconcile_finance              # report only
    python manage.py reconcile_finance --requeue     # re-arm failed messages
"""
from django.core.management.base import BaseCommand
from django.db.models import Sum
from django.utils import timezone

from backend.finance.models import OutboxMessage, Wallet, LedgerEntry


class Command(BaseCommand):
    help = "Reconcile local finance state and recover stuck outbox messages."

    def add_arguments(self, parser):
        parser.add_argument('--requeue', action='store_true',
                            help="Reset failed messages back to pending.")

    def handle(self, *args, **opts):
        by_status = {row['status']: row['n'] for row in
                     OutboxMessage.objects.values('status')
                     .annotate(n=Sum('attempts') * 0 + 1).values('status', 'n')}
        counts = {s: OutboxMessage.objects.filter(status=s).count()
                  for s in ('pending', 'sent', 'failed')}
        self.stdout.write(f"outbox: {counts}")

        # Local ledger integrity: wallet balance must equal the sum of entries.
        drift = []
        for w in Wallet.objects.all():
            total = (LedgerEntry.objects.filter(wallet=w)
                     .aggregate(s=Sum('amount_cents'))['s'] or 0)
            if total != w.balance_cents:
                drift.append((w.client_id, w.balance_cents, total))
        if drift:
            self.stdout.write(self.style.ERROR(f"LEDGER DRIFT on {len(drift)} wallets:"))
            for cid, bal, total in drift:
                self.stdout.write(f"  client {cid}: balance={bal} ledger_sum={total}")
        else:
            self.stdout.write(self.style.SUCCESS("ledger integrity OK"))

        if opts['requeue']:
            n = OutboxMessage.objects.filter(status='failed').update(
                status='pending', attempts=0, next_attempt_at=timezone.now(), last_error='')
            self.stdout.write(self.style.SUCCESS(f"re-armed {n} failed messages"))
