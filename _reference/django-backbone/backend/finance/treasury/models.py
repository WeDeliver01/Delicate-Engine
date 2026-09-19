"""
Treasury domain models. Money is integer cents throughout. All models declare
app_label 'finance' so their migrations live with the finance app and they sit
inside backend.finance.treasury as requested.
"""
from django.db import models
from django.utils import timezone

CATEGORIES = [
    ('cost', 'Variable cost (fuel, driver)'),
    ('operating_expense', 'Fixed operating expense'),
    ('reserve', 'Reserve'),
    ('capital', 'Capital / retained earnings'),
]


def current_period():
    return timezone.now().strftime('%Y-%m')


class AllocationWallet(models.Model):
    """A company-internal wallet. Distinct from the per-client Wallet: this holds
    Delicate's own ring-fenced funds, not customer prepaid balances."""
    name = models.CharField(max_length=80)
    slug = models.SlugField(max_length=60, unique=True)
    category = models.CharField(max_length=20, choices=CATEGORIES)
    balance_cents = models.BigIntegerField(default=0)
    priority = models.IntegerField(default=100, help_text="Lower funds first.")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = 'finance'
        ordering = ['priority', 'name']

    def __str__(self):
        return f"{self.name} ({self.category})"

    # Target the wallet funds toward each period. Operating wallets take it from
    # their obligation; reserves/capital from a FundingTarget. Capital with no
    # target is an unbounded sink (retained earnings catches the remainder).
    def target_cents(self):
        ob = getattr(self, 'obligation', None)
        if ob and ob.is_active:
            return ob.amount_cents
        ft = getattr(self, 'funding_target', None)
        if ft and ft.is_active:
            return ft.target_cents
        return 0

    @property
    def is_sink(self):
        return self.category == 'capital' and self.target_cents() == 0

    def funded_this_period(self, period=None):
        period = period or current_period()
        agg = self.transactions.filter(period=period, kind__in=('allocation', 'overflow')) \
            .aggregate(s=models.Sum('amount_cents'))
        return agg['s'] or 0

    def remaining_need(self, period=None):
        if self.is_sink:
            return None  # unbounded
        return max(0, self.target_cents() - self.funded_this_period(period))

    def funded(self, period=None):
        if self.is_sink:
            return False
        return self.remaining_need(period) == 0


class FundingTarget(models.Model):
    """A monthly target balance for a wallet (used by reserves/capital). Operating
    wallets derive their target from the ExpenseObligation instead."""
    wallet = models.OneToOneField(AllocationWallet, on_delete=models.CASCADE, related_name='funding_target')
    target_cents = models.BigIntegerField(default=0)
    cadence = models.CharField(max_length=12, default='monthly')
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = 'finance'

    def __str__(self):
        return f"Target({self.wallet.slug}={self.target_cents})"


class ExpenseObligation(models.Model):
    """A recurring fixed obligation with a due date. Drives both the funding target
    and the due-date urgency that accelerates allocation as the date approaches."""
    RECURRENCE = [('monthly', 'Monthly')]
    wallet = models.OneToOneField(AllocationWallet, on_delete=models.CASCADE, related_name='obligation')
    vendor = models.CharField(max_length=80)
    amount_cents = models.BigIntegerField()
    due_day = models.IntegerField(default=1, help_text="Day of month the debit order runs (1-31).")
    recurrence = models.CharField(max_length=12, choices=RECURRENCE, default='monthly')
    priority = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = 'finance'
        ordering = ['priority', 'due_day']

    def __str__(self):
        return f"{self.vendor} R{self.amount_cents/100:,.2f} due day {self.due_day}"


class AllocationRule(models.Model):
    """The recommended steady-state share of contribution margin for a wallet,
    derived from obligations and historical margin (never hardcoded). Recomputed
    by the recommender; the runtime engine uses live need + urgency, and this row
    is the transparent plan the dashboard shows."""
    wallet = models.OneToOneField(AllocationWallet, on_delete=models.CASCADE, related_name='rule')
    percent_bps = models.IntegerField(default=0, help_text="Basis points of contribution margin. 10000 = 100%.")
    priority = models.IntegerField(default=100)
    basis = models.CharField(max_length=255, blank=True)
    computed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label = 'finance'
        ordering = ['priority']

    def __str__(self):
        return f"Rule({self.wallet.slug}={self.percent_bps}bps)"


class AllocationTransaction(models.Model):
    """Append-only, auditable, reversible record of one fund movement into a wallet.
    Double-entry compatible: every row names its source (the contribution-margin
    clearing line) and destination wallet. Idempotent on idempotency_key."""
    KIND = [
        ('cost_fuel', 'Fuel cost'),
        ('cost_driver', 'Driver payout'),
        ('allocation', 'Expense allocation'),
        ('overflow', 'Reserve / retained overflow'),
        ('reversal', 'Reversal'),
    ]
    booking = models.ForeignKey('finance.Booking', null=True, blank=True,
                                on_delete=models.SET_NULL, related_name='allocation_txns')
    wallet = models.ForeignKey(AllocationWallet, on_delete=models.PROTECT, related_name='transactions')
    amount_cents = models.BigIntegerField(help_text="Signed. Credit to wallet > 0, reversal < 0.")
    kind = models.CharField(max_length=16, choices=KIND)
    period = models.CharField(max_length=7, db_index=True, default=current_period)
    source = models.CharField(max_length=40, default='contribution_margin')
    idempotency_key = models.CharField(max_length=128, unique=True)
    description = models.CharField(max_length=255, blank=True)
    reversed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        app_label = 'finance'
        ordering = ['-created_at']
        indexes = [models.Index(fields=['wallet', 'period'])]

    def __str__(self):
        return f"{self.kind} {self.wallet.slug} {self.amount_cents}"
