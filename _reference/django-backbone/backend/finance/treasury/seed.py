"""Seed the treasury wallets, obligations and reserve targets. Idempotent."""
from .models import AllocationWallet, ExpenseObligation, FundingTarget

R = lambda rands: int(round(rands * 100))

# vendor, slug, rands, due_day, priority
OBLIGATIONS = [
    ('Vehicle Installment', 'vehicle-finance', 17500.00, 1, 10),
    ('Payroll', 'payroll', 9000.00, 25, 20),
    ('Loan Repayment', 'loan-repayment', 6300.00, 15, 30),
    ('Replit', 'software-replit', 4500.00, 1, 40),
    ('ShipLogic', 'shiplogic', 1300.00, 1, 45),
    ('Outsurance', 'insurance-outsurance', 1900.00, 1, 50),
    ('Auto & General', 'insurance-autogeneral', 1560.00, 1, 55),
    ('Incredible Connection', 'incredible-connection', 1950.00, 1, 60),
    ('SANRAL', 'sanral', 1300.00, 1, 70),
    ('Netstar', 'netstar', 1155.16, 1, 80),
    ('Airtime', 'airtime', 400.00, 1, 90),
]
# slug, name, rands target, priority
RESERVES = [
    ('tax-reserve', 'Tax Reserve', 0.00, 110),
    ('emergency-reserve', 'Emergency Reserve', 5000.00, 120),
    ('vehicle-replacement', 'Vehicle Replacement', 3000.00, 130),
    ('expansion-reserve', 'Expansion Reserve', 0.00, 140),
]


def seed_treasury():
    created = []
    for slug, name in [(slug := 'cost-fuel', 'Fuel'), ('cost-driver', 'Driver Payout')]:
        w, c = AllocationWallet.objects.get_or_create(
            slug=slug, defaults={'name': name, 'category': 'cost', 'priority': 1})
        created.append((slug, c))
    for vendor, slug, rands, due, pr in OBLIGATIONS:
        w, c = AllocationWallet.objects.get_or_create(
            slug=slug, defaults={'name': vendor, 'category': 'operating_expense', 'priority': pr})
        ExpenseObligation.objects.get_or_create(
            wallet=w, defaults={'vendor': vendor, 'amount_cents': R(rands),
                                'due_day': due, 'priority': pr})
        created.append((slug, c))
    for slug, name, rands, pr in RESERVES:
        w, c = AllocationWallet.objects.get_or_create(
            slug=slug, defaults={'name': name, 'category': 'reserve', 'priority': pr})
        FundingTarget.objects.get_or_create(wallet=w, defaults={'target_cents': R(rands)})
        created.append((slug, c))
    w, c = AllocationWallet.objects.get_or_create(
        slug='retained-earnings', defaults={'name': 'Retained Earnings', 'category': 'capital', 'priority': 200})
    created.append(('retained-earnings', c))
    return created
