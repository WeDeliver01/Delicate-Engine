# Delicate Financial Engine

The single source of financial truth for a perishable-goods courier running a
driver-partner model. Node.js + TypeScript, PostgreSQL + Drizzle, a REST API and
two dashboards (admin + driver). Type-checked end to end; the money and vesting
logic is unit-verified.

It answers, for every delivery: what did we charge, what did fuel cost, what does
the driver earn, what do we keep — and it turns that into **two driver wallets**
(spendable earnings + a restricted fuel card) with a Tuesday payout cycle.

---

## The money model (read this first)

Per delivery the customer's price splits in this exact order:

```
price (customer pays)
  ├─ FUEL          → loaded to the driver's FUEL CARD (restricted, never cash, never vests)
  └─ POOL = price − fuel
       ├─ COMPANY share   (e.g. 30%)  → company revenue
       └─ DRIVER share    (e.g. 70%)  → driver EARNINGS wallet (vests on a Tuesday)
```

The driver only ever sees the **post-fuel pool** and their share of it. Fuel is
the company's cost; we fund it straight onto the fuel card so the driver can work
without paying out of pocket, and it can only be spent on fuel.

### Tuesday vesting (the lock)

Earnings vest on a **Tuesday cycle** (Africa/Johannesburg). A delivery's earning
is **locked until the Tuesday that opens the next week**, so a driver always works
a full Tue->Mon week before that week's money unlocks. Once a Tuesday has passed,
that money is freely withdrawable any day.

```
week of an earning = [Tue 00:00 SAST  ..  +7 days)
unlock             = start of that week + 7 days   (the next Tuesday)
```

Verified: money earned Wed/Mon/Tue of one week all unlock the _following_ Tuesday;
this week's earnings show as `locked`, last week's as `available`.

### Payouts

`availableForPayout` = vested earnings, net of any reservations. Requesting a
payout immediately posts a `payout` debit (funds reserved, can't double-spend);
admin marks it `paid` (disbursed) or `cancelled` (auto-reversed). Drivers submit
on the Tuesday cycle; vested balances can be drawn any time after.

---

## 1. Architecture

```
 Admin dashboard ─┐                          ┌─ Driver dashboard
                  v                          v
            +──────────────── Express API ───────────────+
            │  adminAuth (API key)   driverAuth (token)   │
            +───────┬─────────────────────────┬───────────+
                    v                          v
   deliveryService ──> routeService ──> Google Routes API / mock
        │  one DB txn                   (depot->bakery->customer->depot)
        ├─ pricingService  (rule resolution + COGS + split, pure)
        ├─ walletService   (append-only ledger, 2 accounts, vesting)
        ├─ payoutService / fuelService
        └─ importService   (booking CSV -> editable zone_rates)
                    │
                    v
              PostgreSQL — wallet_transactions is the ledger of record
              balance(driver, account) = SUM(amount_cents)
```

Invariants: money is **integer cents**, never floats. The Google call is **never**
inside a DB transaction. Every money-touching write is **idempotent**. **No balance
is ever stored** — it's always summed from the ledger. **Pricing is data** (rows),
not code.

---

## 2. Folder structure

```
src/
├── config/index.ts
├── db/{schema.ts, client.ts}
├── domain/types.ts
├── lib/{money.ts, vesting.ts, csv.ts, googleMaps.ts}
├── services/
│   ├── routeService.ts        pricingService.ts
│   ├── walletService.ts       fuelService.ts        payoutService.ts
│   ├── deliveryService.ts     importService.ts      adminService.ts
├── api/server.ts        # Express: admin + driver routes, CRUD, import, auth
└── examples/{seed.ts, createDelivery.ts}
public/{admin.html, driver.html}
```

---

## 3. Data model (Drizzle)

| Table                       | Purpose                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `drivers`                   | partner, depot lat/lng, fuel card id, portal token                                                      |
| `bakeries`                  | client + pickup point (unique `code`)                                                                   |
| `driver_bakery_assignments` | pairing: which driver serves which bakery                                                               |
| `zone_rates`                | **editable / CSV-importable** charged price per client x zone                                           |
| `pricing_rules`             | cost + split config, scoped global/zone/bakery/driver/band                                              |
| `deliveries`                | the job + price + settlement snapshot                                                                   |
| `routes`                    | per-delivery distance/duration + leg breakdown                                                          |
| `wallet_transactions`       | **append-only ledger**, account in {earnings, fuel}, signed cents, `available_from` vesting, idempotent |
| `payout_requests`           | driver withdrawals (pending/paid/cancelled)                                                             |
| `rate_imports`              | CSV import audit                                                                                        |
| `wallet_checkpoints`        | optional balance checkpoint for scale                                                                   |

Everything is editable: driver/bakery/client addresses and coords, every fuel
cost-per-km and driver share (`pricing_rules`), and every rate per zone per client
(`zone_rates`) — via the admin API/dashboard.

---

## 4. API surface

Admin (`Authorization: Bearer <ADMIN_API_KEY>`):

```
GET   /api/admin/overview                 company P&L snapshot
GET   /api/admin/driver-balances          per-driver available/locked/fuel
GET   /api/admin/activity                 recent deliveries + payouts
GET/POST/PATCH/DELETE /api/admin/{drivers|bakeries|zone-rates|pricing-rules}
POST  /api/admin/assignments              pair a driver to a bakery
POST  /api/admin/deliveries               create -> settle (full flow)
POST  /api/admin/import                   raw CSV (text/csv) -> zone_rates
GET   /api/admin/payouts ; PATCH /api/admin/payouts/:id   {status}
POST  /api/admin/drivers/:id/fuel-spend   record a fuel-card swipe
```

Driver (`Authorization: Bearer <portalToken>`):

```
GET   /api/driver/me
GET   /api/driver/wallet      earnings{total,available,locked,nextUnlock} + fuelCents
GET   /api/driver/ledger?account=earnings|fuel
GET   /api/driver/deliveries
POST  /api/driver/payouts     request a payout of available funds
```

**Auth note:** the admin key and per-driver portal token are MVP-grade. Before
real drivers log in, swap the driver token for phone+OTP or JWT, and put the admin
behind your IdP. The service layer doesn't change.

---

## 5. Example flow

```
delivery created -> route calculated -> COGS computed -> split applied -> wallets updated
```

```bash
cp .env.example .env            # DATABASE_URL; ROUTE_PROVIDER=mock works with no key
npm install
npm run db:generate && npm run db:migrate
npm run seed                    # prints a driver portal token
npm run example                 # runs one delivery end-to-end
node --env-file=.env --import tsx src/api/server.ts   # API + dashboards on :3000
```

Open `/admin.html` (enter `ADMIN_API_KEY`) and `/driver.html` (enter the seeded
token). Verified settlement for R273.49 / 61 km:

```
fuel -> card : R120.78
driver share : R106.90   (locked until next Tuesday)
company keeps: R45.81
margin       : 16.8%
```

CSV import: on the admin dashboard, upload your Shiplogic/booking export — it
averages the charged rate per client x zone into the editable rate card.

---

## 6. Scaling to 1,000+ drivers

- Stateless services, small pool (`pool.max ~ 20` per instance) + PgBouncer.
- Indexes: `wallet_transactions(driver_id, account, created_at)` and
  `(driver_id, account, available_from)`; unique idempotency keys everywhere.
- Balance stays cheap (indexed `SUM`); `wallet_checkpoints` lets `getBalance` sum
  only rows after the last checkpoint once ledgers reach millions of rows.
- Idempotency = safe behind an at-least-once queue; no double-pay, no double-fuel.
- Route responses cached on the `routes` row; memoise identical depot/pickup pairs.

### Deliberate non-goals (MVP)

- Real auth (OTP/JWT/IdP) and the actual payout disbursement integration are
  stubs — the ledger already has the `payout` entry type and the request flow.
- Dashboards are functional but lean; they're real fetch clients you can restyle.
