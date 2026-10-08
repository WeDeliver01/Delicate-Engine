import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { allocationWallets, users } from "@delicate/db";
import type {
  AccountBalance,
  Booking,
  CatalogResponse,
  Driver,
  PayablesSummary,
  PaymentProposal,
  Quote,
  Settlement,
} from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { TreasuryService } from "../src/modules/treasury/treasury.service.js";
import { LedgerService, cr, dr } from "../src/modules/ledger/ledger.service.js";
import { Clock } from "../src/infra/clock.js";

const MENLYN = { lat: -25.7826, lng: 28.2755 };
const CENTURION = { lat: -25.8603, lng: 28.1894 };
const addr = (formatted: string, location: { lat: number; lng: number }, suburb: string) => ({
  formatted,
  line1: null,
  suburb,
  city: "Pretoria",
  postalCode: null,
  country: "ZA",
  location,
  placeId: null,
});
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const DRIVER_USER = {
  id: "10000000-0000-4000-8000-000000000022",
  email: "lerato@delicatecourier.local",
};

describe("payment proposals: the engine proposes, a human executes", () => {
  let h: Harness;
  let treasury: TreasuryService;
  let ledger: LedgerService;
  let wallet: WalletService;
  let owner: string;
  let finance: string;
  let driverToken: string;
  let accountId: string;
  let cakeId: string;
  let driver: Driver;
  const TODAY = "2026-09-23";

  beforeAll(async () => {
    h = await createHarness();
    treasury = h.app.get(TreasuryService);
    ledger = h.app.get(LedgerService);
    wallet = h.app.get(WalletService);
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z");
    owner = await h.tokenFor(USERS.alice);
    finance = await h.tokenFor(USERS.admin);
    driverToken = await h.tokenFor(DRIVER_USER);
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "super_admin" });
    const acc = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Honey Bee", type: "business", organization: { name: "Honey Bee Bakers" } });
    accountId = acc.body.id;
    await wallet.adjust(accountId, 500_000, "test funds");
    cakeId = ((await h.http().get("/v1/public/catalog")).body as CatalogResponse).packageTypes.find(
      (p) => p.code === "cake_single",
    )!.id;

    const veh = await h.http().post("/v1/admin/fleet/vehicles").set(asFinance()).send({
      registration: "DC 03 GP",
      make: "Toyota",
      model: "Quantum",
      fuelType: "petrol",
      litresPer100Km: 11,
    });
    driver = (
      await h.http().post("/v1/admin/fleet/drivers").set(asFinance()).send({
        email: DRIVER_USER.email,
        fullName: "Lerato Mokoena",
        phone: "0845551234",
        vehicleId: veh.body.id,
        dailyStopCapacity: 10,
        fuelCardRef: "6001 2345 6789 4242",
      })
    ).body as Driver;
  });

  const asOwner = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const asFinance = () => ({ Authorization: `Bearer ${finance}` });
  const asDriver = () => ({ Authorization: `Bearer ${driverToken}` });

  const prepare = async (body: Record<string, unknown>) => {
    const res = await h.http().post("/v1/admin/payments/runs").set(asFinance()).send(body);
    expect(res.status).toBe(201);
    return res.body as PaymentProposal[];
  };
  const payables = async () =>
    (await h.http().get("/v1/admin/payments/payables").set(asFinance())).body as PayablesSummary;

  /** Book, assign, collect and deliver one drop so a settlement (and payables) exist. */
  async function deliverOne(): Promise<Settlement> {
    const q = (
      await h
        .http()
        .post("/v1/account/quotes")
        .set(asOwner())
        .send({
          serviceLevelCode: "on_demand",
          collection: {
            address: addr("Honey Bee, Menlyn", MENLYN, "Menlyn"),
            contact: { name: "Baker", phone: "0821111111", email: null },
            instructions: null,
          },
          drops: [
            {
              address: addr("12 Oak St, Centurion", CENTURION, "Centurion"),
              recipient: { name: "Jane", phone: "0821234567", email: null },
              instructions: null,
              parcels: [
                { packageTypeId: cakeId, quantity: 1, weightKg: null, description: "Cake" },
              ],
            },
          ],
          options: {},
        })
    ).body as Quote;
    const b = (await h.http().post("/v1/account/bookings").set(asOwner()).send({ quoteId: q.id }))
      .body as Booking;
    await h
      .http()
      .post("/v1/admin/fleet/shifts")
      .set(asFinance())
      .send({ driverId: driver.id, date: TODAY });
    await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/auto-assign`)
      .set(asFinance())
      .expect(201);
    await h
      .http()
      .post("/v1/driver/collect")
      .set(asDriver())
      .send({ bookingId: b.id, location: MENLYN })
      .expect(201);
    await h
      .http()
      .post("/v1/driver/deliver")
      .set(asDriver())
      .send({
        shipmentId: b.shipments[0]!.id,
        receivedBy: "Jane",
        photoDataUrl: PNG,
        actualKm: 20,
      })
      .expect(201);
    await h.dispatcher.tick();
    return (
      await h
        .http()
        .get(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/settlement`)
        .set(asFinance())
    ).body.settlement as Settlement;
  }

  it("proposes exactly what the ledger says the driver is owed, with the deliveries as evidence", async () => {
    const s = await deliverOne();
    const before = await payables();
    expect(before.driverEarningsOwedCents).toBe(s.driverEarningCents);
    expect(before.fuelCardOwedCents).toBe(s.fuelCostCents);

    const [payout] = await prepare({ kind: "driver_earnings_payout" });
    expect(payout).toMatchObject({
      kind: "driver_earnings_payout",
      status: "proposed",
      amountCents: s.driverEarningCents,
      method: "eft",
      driverId: driver.id,
      journalId: null,
    });
    expect(payout!.reference).toMatch(/^PAY-2609-\d{4}$/);
    expect(payout!.basis.items).toHaveLength(1);
    expect(payout!.basis.items[0]!.amountCents).toBe(s.driverEarningCents);
    expect(payout!.basis.payableBalanceCents).toBe(s.driverEarningCents);

    // proposing posts nothing to the books: the driver is still owed the full amount
    expect(-(await ledger.balance("DRIVER_EARNINGS_PAYABLE", "driver", driver.id))).toBe(
      s.driverEarningCents,
    );
    const after = await payables();
    expect(after.committedCents).toBe(s.driverEarningCents);
    expect(after.bankBalanceCents).toBe(0);
  });

  it("will not propose the same payout twice while one is still open", async () => {
    await deliverOne();
    const first = await prepare({ kind: "driver_earnings_payout" });
    expect(first).toHaveLength(1);
    const second = await prepare({ kind: "driver_earnings_payout" });
    expect(second).toHaveLength(0); // already committed
  });

  it("skips amounts under the minimum so a tiny payout does not cost an EFT fee", async () => {
    await deliverOne();
    expect(await prepare({ kind: "driver_earnings_payout", minimumCents: 100_000 })).toHaveLength(
      0,
    );
  });

  it("refuses to execute a proposal nobody approved", async () => {
    await deliverOne();
    const [p] = await prepare({ kind: "driver_earnings_payout" });
    const res = await h
      .http()
      .post(`/v1/admin/payments/proposals/${p!.id}/execute`)
      .set(asFinance())
      .send({ externalReference: "EFT-123" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("proposal_state_invalid");
  });

  it("posts the payout journal only when a human records that they paid it", async () => {
    const s = await deliverOne();
    const [p] = await prepare({ kind: "driver_earnings_payout" });

    const approved = (
      await h
        .http()
        .post(`/v1/admin/payments/proposals/${p!.id}/approve`)
        .set(asFinance())
        .send({ note: "weekly run" })
        .expect(201)
    ).body as PaymentProposal;
    expect(approved).toMatchObject({ status: "approved", approvedByUserId: USERS.admin.id });
    expect(approved.journalId).toBeNull(); // approval is not payment

    const executed = (
      await h
        .http()
        .post(`/v1/admin/payments/proposals/${p!.id}/execute`)
        .set(asFinance())
        .send({ externalReference: "FNB-778341", method: "eft" })
        .expect(201)
    ).body as PaymentProposal;
    expect(executed).toMatchObject({
      status: "executed",
      externalReference: "FNB-778341",
      executedByUserId: USERS.admin.id,
    });
    expect(executed.journalId).not.toBeNull();

    // the payable is cleared and the bank shows the money gone
    expect(await ledger.balance("DRIVER_EARNINGS_PAYABLE", "driver", driver.id)).toBe(0);
    expect(await ledger.balance("BANK", "company", null)).toBe(-s.driverEarningCents);
    const tb = await ledger.trialBalance();
    expect(tb.totalCents).toBe(0);

    // executing twice is refused, not double-paid
    const replay = await h
      .http()
      .post(`/v1/admin/payments/proposals/${p!.id}/execute`)
      .set(asFinance())
      .send({ externalReference: "FNB-778341" });
    expect(replay.status).toBe(409);
  });

  it("gives a person instructions for a fuel load instead of calling PayCentral", async () => {
    await deliverOne();
    const [p] = await prepare({ kind: "driver_fuel_load" });
    expect(p!.method).toBe("paycentral");
    const body = (
      await h
        .http()
        .get(`/v1/admin/payments/proposals/${p!.id}/fuel-load-instructions`)
        .set(asFinance())
        .expect(200)
    ).body as { instruction: { automated: boolean; steps: string[]; proofRequired: string } };
    expect(body.instruction.automated).toBe(false);
    expect(body.instruction.steps.join(" ")).toContain("•••• 4242"); // card is masked
    expect(body.instruction.proofRequired).toMatch(/PayCentral/);

    await h.http().post(`/v1/admin/payments/proposals/${p!.id}/approve`).set(asFinance()).send({});
    await h
      .http()
      .post(`/v1/admin/payments/proposals/${p!.id}/execute`)
      .set(asFinance())
      .send({ externalReference: "PC-90211", method: "paycentral" })
      .expect(201);
    expect(await ledger.balance("FUEL_PAYABLE", "driver", driver.id)).toBe(0);
  });

  it("proposes a vendor bill only once its wallet has actually saved up for it", async () => {
    // premises needs R9 500; a little margin is spread across urgent bills, so it stays short
    await h.db.transaction((tx) =>
      treasury.allocateMargin(tx, { reference: "shipment:seed-short", marginCents: 500_000 }),
    );
    expect(await prepare({ kind: "vendor_payment", walletSlug: "premises" })).toHaveLength(0);

    // enough margin to cover every obligation, and now premises is fully funded
    await h.db.transaction((tx) =>
      treasury.allocateMargin(tx, { reference: "shipment:seed-full", marginCents: 10_000_000 }),
    );
    const wallets = await h.db.db
      .select()
      .from(allocationWallets)
      .where(eq(allocationWallets.slug, "premises"));
    expect(wallets[0]!.balanceCents).toBeGreaterThanOrEqual(950_000);

    const [p] = await prepare({ kind: "vendor_payment", walletSlug: "premises" });
    expect(p).toMatchObject({
      kind: "vendor_payment",
      amountCents: 950_000,
      vendorName: "Landlord",
    });

    await h.http().post(`/v1/admin/payments/proposals/${p!.id}/approve`).set(asFinance()).send({});
    await h
      .http()
      .post(`/v1/admin/payments/proposals/${p!.id}/execute`)
      .set(asFinance())
      .send({ externalReference: "EFT-RENT-09" })
      .expect(201);

    // the wallet is drawn down so the bill cannot be funded or paid twice…
    const after = await h.db.db
      .select()
      .from(allocationWallets)
      .where(eq(allocationWallets.slug, "premises"));
    expect(after[0]!.balanceCents).toBe(wallets[0]!.balanceCents - 950_000);
    // …and the overhead is now recognised as an expense
    expect(await ledger.balance("OPERATING_EXPENSE", "company", null)).toBe(950_000);
    expect((await ledger.trialBalance()).totalCents).toBe(0);
  });

  it("records a bank sweep from the clearing account, and refuses one bigger than the cash there", async () => {
    // stand in for a confirmed top-up: customer cash lands in CASH_CLEARING
    await h.db.transaction((tx) =>
      ledger.post(tx, {
        kind: "topup",
        description: "Top-up received",
        idempotencyKey: "test:topup:1",
        lines: [
          dr("CASH_CLEARING", 200_000),
          cr("CUSTOMER_PREPAID_LIABILITY", 200_000, { type: "account", id: accountId }),
        ],
      }),
    );
    const clearing = await ledger.balance("CASH_CLEARING", "company", null);
    expect(clearing).toBe(200_000);

    const tooBig = await h
      .http()
      .post("/v1/admin/payments/bank-sweeps")
      .set(asFinance())
      .send({ amountCents: clearing + 1, reference: "SWEEP-X" });
    expect(tooBig.status).toBe(409);
    expect(tooBig.body.code).toBe("sweep_exceeds_clearing");

    await h
      .http()
      .post("/v1/admin/payments/bank-sweeps")
      .set(asFinance())
      .send({ amountCents: clearing, reference: "SWEEP-0923" })
      .expect(201);
    expect(await ledger.balance("BANK", "company", null)).toBe(clearing);
    expect(await ledger.balance("CASH_CLEARING", "company", null)).toBe(0);
    expect((await ledger.trialBalance()).totalCents).toBe(0);
  });

  it("re-proposes after a failed payment, and pays the driver only what is still owed", async () => {
    const s = await deliverOne();
    const [p] = await prepare({ kind: "driver_earnings_payout" });
    await h.http().post(`/v1/admin/payments/proposals/${p!.id}/approve`).set(asFinance()).send({});
    await h
      .http()
      .post(`/v1/admin/payments/proposals/${p!.id}/fail`)
      .set(asFinance())
      .send({ reason: "wrong account number" })
      .expect(201);

    // a failed proposal still holds the claim, so nothing is proposed twice
    expect(await prepare({ kind: "driver_earnings_payout" })).toHaveLength(0);
    // and it can be retried straight to execution
    await h
      .http()
      .post(`/v1/admin/payments/proposals/${p!.id}/execute`)
      .set(asFinance())
      .send({ externalReference: "FNB-RETRY-1" })
      .expect(201);
    expect(await ledger.balance("DRIVER_EARNINGS_PAYABLE", "driver", driver.id)).toBe(0);

    // cancelling instead would have released the claim
    const rows = (await h.http().get("/v1/admin/payments/proposals").set(asFinance()))
      .body as PaymentProposal[];
    expect(rows.filter((r) => r.status === "executed")).toHaveLength(1);
    expect(rows[0]!.amountCents).toBe(s.driverEarningCents);
  });

  it("releases the claim when a proposal is cancelled", async () => {
    await deliverOne();
    const [p] = await prepare({ kind: "driver_earnings_payout" });
    await h
      .http()
      .post(`/v1/admin/payments/proposals/${p!.id}/cancel`)
      .set(asFinance())
      .send({ note: "wrong period" })
      .expect(201);
    const again = await prepare({ kind: "driver_earnings_payout" });
    expect(again).toHaveLength(1);
    expect(again[0]!.id).not.toBe(p!.id);
  });

  it("keeps money movement out of reach of dispatchers", async () => {
    const dispatcherToken = await h.tokenFor(USERS.carol);
    await h.db.db
      .insert(users)
      .values({ ...USERS.carol, platformRole: "dispatcher" })
      .onConflictDoUpdate({ target: users.id, set: { platformRole: "dispatcher" } });
    const asDispatcher = () => ({ Authorization: `Bearer ${dispatcherToken}` });
    await h.http().get("/v1/admin/payments/payables").set(asDispatcher()).expect(403);
    await h
      .http()
      .post("/v1/admin/payments/runs")
      .set(asDispatcher())
      .send({ kind: "driver_earnings_payout" })
      .expect(403);
    await h
      .http()
      .post("/v1/admin/payments/bank-sweeps")
      .set(asDispatcher())
      .send({ amountCents: 1, reference: "X" })
      .expect(403);
  });

  it("never lets the books drift: every proposal state leaves the trial balance at zero", async () => {
    await deliverOne();
    const earn = await prepare({ kind: "driver_earnings_payout" });
    const fuel = await prepare({ kind: "driver_fuel_load" });
    for (const p of [...earn, ...fuel]) {
      await h.http().post(`/v1/admin/payments/proposals/${p.id}/approve`).set(asFinance()).send({});
      await h
        .http()
        .post(`/v1/admin/payments/proposals/${p.id}/execute`)
        .set(asFinance())
        .send({ externalReference: `REF-${p.reference}` })
        .expect(201);
    }
    const tb = await ledger.trialBalance();
    expect(tb.totalCents).toBe(0);
    const bank = tb.rows.find((r: AccountBalance) => r.account === "BANK")!;
    expect(bank.balanceCents).toBeLessThan(0); // money left, and nothing has swept in yet
  });
});
