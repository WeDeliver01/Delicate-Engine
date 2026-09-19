# Delicate Courier Treasury & Allocation Engine

Module: `backend.finance.treasury`. Built as an additive extension of the existing
event-driven financial backbone. Nothing in the client wallet, ledger, outbox or
charge path was replaced.

## 1. The financial reality first (from your 90 days)

485 bookings, 25 Feb to 20 Jun 2026. Total revenue R117,141.66. Average booking
R241.52. That is about R30,699 of revenue per month across roughly 127 bookings.
After fuel (14%) and driver payout (32%), contribution margin runs near 54% of
revenue, so about R16,578 of margin per month.

Your fixed obligations are R46,865.16 per month. Margin covers about 35% of them.

Be clear about what this engine does and does not do. It cannot create the missing
R30,000 a month. What it does is make that gap visible on every booking instead of
at month end, fund the most time-critical obligations first, refuse to leak margin
into reserves or discretionary spend while obligations are unfunded, and forecast
the shortfall so decisions happen early. The structural fix is still revenue up and
variable cost down, which the rate increase and driver-partner work already target.
The engine is the discipline and the visibility layer that makes that work compound.

## 2. Architecture

The treasury layer subscribes to the charge path through the existing transactional
outbox. The flow per booking:

```
charge_booking            (existing: debits client wallet, posts ledger entry)
   └─ enqueue treasury.allocate            (one new outbox message)
outbox dispatcher
   └─ _handle_treasury_allocate
        └─ allocate_for_booking            (idempotent, transactional)
             ├─ compute fuel + driver cost  -> cost wallets
             ├─ contribution margin = revenue - fuel - driver
             ├─ fund obligations by need x due-date urgency
             ├─ cascade surplus -> reserves -> retained earnings
             └─ emit treasury.allocated     (engine notification via outbox)
```

Allocation runs off the charge path, not inside it, so a slow or failed allocation
never blocks a booking, and every allocation is recoverable by redelivering the
outbox message. Company money (treasury wallets) is kept entirely separate from
customer prepaid balances (the per-client Wallet).

## 3. Data model

`AllocationWallet` is a company-internal wallet with a category: cost,
operating_expense, reserve, or capital. It carries a running balance and a priority.

`ExpenseObligation` (one per operating wallet) holds the vendor, the monthly amount
in cents, the debit-order due day, and a priority. It is both the funding target and
the source of due-date urgency.

`FundingTarget` (one per reserve or capital wallet) holds a monthly target balance.
Capital with no target (Retained Earnings) is an unbounded sink.

`AllocationRule` (one per wallet) stores the recommended share of contribution margin
in basis points, derived by the recommender. It is the transparent plan the dashboard
shows; the runtime engine uses live need and urgency.

`AllocationTransaction` is the append-only, double-entry-compatible movement record:
booking, wallet, signed amount, kind (cost_fuel, cost_driver, allocation, overflow,
reversal), period, a unique idempotency_key, and a reversed flag.

Funding progress for a period is the sum of a wallet's allocation and overflow
transactions in that period, so a new calendar month resets progress automatically
without mutating balances.

## 4. Allocation algorithm

Contribution margin is the only money the engine allocates. Never gross revenue.

Phase 1, obligations. For each operating wallet still short of its monthly target,
weight = remaining need x urgency, where urgency rises from 1.0 to about 2.5 as the
debit-order date approaches inside a ten-day window. Margin is allocated across
wallets in proportion to weight, capped at each wallet's remaining need, with a
bounded water-fill loop that redistributes any capped remainder.

Phase 2, cascade. Any margin left once obligations are met flows to reserves in
priority order, each capped at its target (Tax, Emergency, Vehicle Replacement,
Expansion), then everything remaining lands in Retained Earnings. Because the sink
absorbs the remainder, the sum of allocations equals the contribution margin exactly,
so each booking balances.

Idempotency. Every transaction has a deterministic key derived from the booking
reference, and a per-booking marker line makes re-runs a no-op. Redelivery is safe.

Reversibility. `reverse_allocations` posts signed-opposite mirror entries for every
line of a booking and restores balances. It is wired into `reverse_booking`.

## 5. Dynamic recommender, analytics, forecast

No percentages are hardcoded. `recommend_rules` derives each wallet's share from its
obligation and the historical monthly margin. When margin is scarce, which is the
current state, the full margin is split across obligations by weight (the eleven
rules sum to 100%). When margin is ample, each obligation takes target over monthly
margin and the rest is earmarked for reserves. Fuel and driver percentages are
operational inputs from the fleet economics work, set in settings, not allocation
percentages.

`revenue_analytics` and `revenues_from_csv` produce totals, averages, per day, week
and month, contribution margin and margin rate. `forecast` returns, per wallet,
funded-to-date, remaining, progress, days-until-funded and an at-risk flag against
the due date, plus a projected month-end funding level, coverage and shortfall.

## 6. Event definitions

`treasury.allocate` (command, consumed by the dispatcher to run allocation).
`treasury.allocated` (notification, carries the full per-booking breakdown to the
engine and any downstream subscriber such as the CRM).

## 7. API and admin

`GET /api/admin/treasury/dashboard` (Supabase super-admin only) returns the Command
Centre: financial health score, obligation totals and projected coverage, every
expense wallet with progress and days-until-funded, reserves, capital, cost wallets,
upcoming debit orders sorted by due day with covered flags, recent allocation
history, available operating cash (retained balance), and revenue analytics.

Django admin registers every model for manual inspection, correction and audit.

Commands: `treasury_seed` (idempotent), `treasury_import_csv <path> --write-rules`.

## 8. Migration plan

One additive migration creates the five models inside the finance app. It adds no
columns to existing tables and changes no existing behavior beyond a single new
outbox enqueue in the charge path. Apply with `migrate`, then `treasury_seed`. The
allocation handler is a clean no-op until wallets exist, so deploying the code before
seeding is safe.

## 9. Test plan

Twelve tests cover: the contribution-margin formula, that only margin is allocated
and cost is recorded separately, double-entry sum equals margin, idempotent re-runs,
the reserve cascade once obligations are full, reversal unwinding all balances,
urgency weighting, the recommender under scarce margin, the forecast reporting a
shortfall, the dashboard requiring super-admin, and the full charge-then-outbox
integration running allocation. Full suite is 56 tests, all passing.

## 10. Rollout plan

1. Deploy the code. Allocation no-ops because no wallets exist yet.
2. Run `treasury_seed` to create wallets, obligations and reserve targets.
3. Run `treasury_import_csv <export> --write-rules` to load analytics and write the
   recommended rules from your real margin.
4. Run the dispatcher worker as already documented; new bookings allocate from then.
5. Optionally backfill: re-enqueue `treasury.allocate` for recent bookings.
6. Watch the dashboard for a few days, tune fuel and driver percentages to match real
   cost data as it lands, and set reserve targets once obligations are consistently met.

## 11. Failure recovery

Allocation is idempotent and transactional, so a crashed or redelivered message
re-runs without double-counting. A failed allocation leaves the booking charged and
the outbox message pending for retry with backoff. If a booking is reversed, the
allocation is unwound automatically. The append-only transaction log plus the marker
line make the state reconstructable at any time.

## 12. Reconciliation

Per booking, fuel plus driver plus contribution margin equals revenue, and the sum of
allocation and overflow transactions equals the contribution margin, so each booking
nets to zero across the cost line and the wallets. Per wallet per period, the balance
movement equals the sum of its transactions. Against the bank, each obligation wallet's
funded-this-period is compared to the actual debit order on its due day; any wallet
below its obligation as the due day approaches is flagged at-risk on the dashboard.
