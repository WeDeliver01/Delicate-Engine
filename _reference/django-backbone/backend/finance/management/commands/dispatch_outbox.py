"""
Drain the outbox. Run once per scheduler tick, or with --loop as a worker.

    python manage.py dispatch_outbox            # one pass
    python manage.py dispatch_outbox --loop     # continuous (e.g. a Replit worker)
"""
import time

from django.core.management.base import BaseCommand

from backend.finance.outbox import dispatch_due


class Command(BaseCommand):
    help = "Deliver pending outbox messages to the engine and ShipLogic."

    def add_arguments(self, parser):
        parser.add_argument('--loop', action='store_true', help="Run continuously.")
        parser.add_argument('--interval', type=float, default=2.0,
                            help="Seconds between passes in --loop mode.")
        parser.add_argument('--limit', type=int, default=100,
                            help="Max messages per pass.")

    def handle(self, *args, **opts):
        if not opts['loop']:
            stats = dispatch_due(limit=opts['limit'])
            self.stdout.write(self.style.SUCCESS(f"outbox pass: {stats}"))
            return
        self.stdout.write("outbox worker started (ctrl-c to stop)")
        while True:
            try:
                stats = dispatch_due(limit=opts['limit'])
                if any(v for v in stats.values()):
                    self.stdout.write(f"{stats}")
                time.sleep(opts['interval'])
            except KeyboardInterrupt:
                self.stdout.write("stopping")
                break
