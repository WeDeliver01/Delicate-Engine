import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { allocationTransactions, users } from "@delicate/db";
import type {
  AllocationTransaction,
  AllocationWallet,
  Booking,
  CatalogResponse,
  Quote,
  Settlement,
  TreasuryDashboard,
} from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { TreasuryService } from "../src/modules/treasury/treasury.service.js";
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
  id: "10000000-0000-4000-8000-000000000021",
  email: "thabo@delicatecourier.local",
};

describe("treasury allocation", () => {
  let h: Harness;
  let treasury: TreasuryService;
  let wallet: WalletService;
  let owner: string;
  let staff: string;
  let driverToken: string;
  let accountId: string;
  let cakeId: string;
  let driverId: string;
  const TODAY = "2026-09-23";

  beforeAll(async () => {
    h = await createHarness();
    treasury = h.app.get(TreasuryService);
    wallet = h.app.get(WalletService);
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z");
    owner = await h.tokenFor(USERS.alice);
    staff = await h.tokenFor(USERS.admin);
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
  });

  const asOwner = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const asStaff = () => ({ Authorization: `Bearer ${staff}` });
  const asDriver = () => ({ Authorization: `Bearer ${driverToken}` });

  const walletsBySlug = async () => {
    const rows = (await h.http().get("/v1/admin/treasury/wallets").set(asStaff()))
      .body as AllocationWallet[];
    return Object.fromEntries(rows.map((w) => [w.slug, w]));
  };
  const txFor = async (reference: string) =>
    h.db.db
      .select()
      .from(allocationTransactions)
      .where(eq(allocationTransactions.reference, reference));

  const allocate = (reference: string, marginCents: number, at?: string) =>
    h.db.transaction((tx) =>
      treasury.allocateMargin(tx, {
        reference,
        marginCents,
        at: at ? new Date(at) : undefined,
      }),
    );

  it("seeds the starter wallets with exactly one retained-earnings sink", async () => {
    const bySlug = await walletsBySlug();
    expect(bySlug["premises"]!.obligation).toMatchObject({
      monthlyAmountCents: 950_000,
      dueDay: 1,
    });
    expect(bySlug["tax"]!.monthlyTargetCents).toBe(1_500_000);
    const sinks = Object.values(bySlug).filter((w) => w.isRetainedEarnings);
    expect(sinks.map((w) => w.slug)).toEqual(["retained"]);
  });

  it("earmarks a margin so the lines sum to it exactly, and moves the wallet balances", async () => {
    const result = await allocate("shipment:manual-1", 120_000);
    expect(result.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(120_000);
    expect(result.period).toBe("2026-09");

    const rows = await txFor("shipment:manual-1");
    expect(rows.length).toBe(result.lines.length);
    expect(rows.every((r) => r.period === "2026-09")).toBe(true);

    // balances move with the transactions, and balance_after is the running total
    const bySlug = await walletsBySlug();
    for (const line of result.lines) {
      expect(bySlug[line.walletSlug]!.balanceCents).toBe(line.amountCents);
      const row = rows.find((r) => r.walletId === bySlug[line.walletSlug]!.id)!;
      expect(row.balanceAfterCents).toBe(line.amountCents);
    }
  });

  it("is idempotent: re-allocating the same reference does not double-count", async () => {
    const first = await allocate("shipment:manual-2", 80_000);
    const again = await allocate("shipment:manual-2", 80_000);
    expect(again.marginCents).toBe(first.marginCents);
    const rows = await txFor("shipment:manual-2");
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(80_000);
  });

  it("books a loss-making drop against retained earnings so the reconciliation rule still holds", async () => {
    const result = await allocate("shipment:manual-3", -4_200);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      walletSlug: "retained",
      amountCents: -4_200,
      kind: "adjustment",
    });
    const bySlug = await walletsBySlug();
    expect(bySlug["retained"]!.balanceCents).toBe(-4_200);
  });

  it("funds the urgent debit order first, then cascades to reserves once obligations are covered", async () => {
    // 23 September, 10-day window: salaries (25th, 2 days) and premises (1st, 8 days) are urgent;
    // vehicle finance (3rd) sits exactly 10 days out, so it waits for the next tier.
    await allocate("shipment:urgent", 200_000);
    const bySlug = await walletsBySlug();
    expect(bySlug["salaries"]!.balanceCents).toBeGreaterThan(bySlug["premises"]!.balanceCents);
    expect(bySlug["premises"]!.balanceCents).toBeGreaterThan(0);
    expect(bySlug["vehicle-finance"]!.balanceCents).toBe(0);
    expect(bySlug["tax"]!.balanceCents).toBe(0); // reserves gated while obligations are short
    expect(bySlug["salaries"]!.balanceCents + bySlug["premises"]!.balanceCents).toBe(200_000);

    // enough margin to clear every obligation → the cascade reaches reserves and the sink
    const total = Object.values(bySlug)
      .filter((w) => w.obligation)
      .reduce((s, w) => s + w.obligation!.monthlyAmountCents, 0);
    await allocate("shipment:ample", total + 5_000_000);
    const after = await walletsBySlug();
    for (const w of Object.values(after).filter((x) => x.obligation)) {
      expect(w.balanceCents).toBe(w.obligation!.monthlyAmountCents);
    }
    expect(after["tax"]!.balanceCents).toBe(1_500_000);
    expect(after["retained"]!.balanceCents).toBeGreaterThan(0);
  });

  it("resets funding progress in a new period without moving money", async () => {
    await allocate("shipment:sep", 300_000, "2026-09-23T07:00:00Z");
    const sep = await walletsBySlug();
    await allocate("shipment:oct", 300_000, "2026-10-05T07:00:00Z");
    const oct = await walletsBySlug();

    // balances accumulate across months…
    expect(Object.values(oct).reduce((s, w) => s + w.balanceCents, 0)).toBe(600_000);
    // …but October's allocation saw zero funded, so it targeted obligations afresh
    const octRows = await txFor("shipment:oct");
    expect(octRows.every((r) => r.period === "2026-10")).toBe(true);
    const sepRows = await txFor("shipment:sep");
    expect(sepRows.every((r) => r.period === "2026-09")).toBe(true);
    // October saw zero funded, so it went to obligations again rather than overflowing to the sink
    expect(octRows.every((r) => r.kind === "allocation")).toBe(true);
    expect(oct["retained"]!.balanceCents).toBe(sep["retained"]!.balanceCents);
  });

  it("reverses an allocation with mirror rows, leaving the forward rows intact", async () => {
    await allocate("shipment:manual-4", 60_000);
    const reversed = await h.db.transaction((tx) =>
      treasury.reverse(tx, "shipment:manual-4", "settlement corrected"),
    );
    expect(reversed.marginCents).toBe(0); // forward + mirror
    const rows = await txFor("shipment:manual-4");
    expect(rows.filter((r) => r.kind === "reversal").length).toBeGreaterThan(0);
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(0);
    const bySlug = await walletsBySlug();
    expect(Object.values(bySlug).reduce((s, w) => s + w.balanceCents, 0)).toBe(0);

    // reversing twice is a no-op, not a double credit
    await h.db.transaction((tx) => treasury.reverse(tx, "shipment:manual-4", "again"));
    const after = await txFor("shipment:manual-4");
    expect(after.reduce((s, r) => s + r.amountCents, 0)).toBe(0);
  });

  it("reports funding progress, risk and the next debit orders on the dashboard", async () => {
    await allocate("shipment:dash", 1_000_000);
    const d = (await h.http().get("/v1/admin/treasury/dashboard").set(asStaff()))
      .body as TreasuryDashboard;
    expect(d.period).toBe("2026-09");
    expect(d.marginThisPeriodCents).toBe(1_000_000);
    expect(d.obligationsTotalCents).toBe(8_140_000);
    expect(d.shortfallCents).toBe(d.obligationsTotalCents - d.obligationsFundedCents);
    expect(d.healthScore).toBeGreaterThan(0);
    expect(d.healthScore).toBeLessThan(100);
    expect(d.operating.some((f) => f.atRisk)).toBe(true);
    // the 25th is two days out, so salaries head the queue
    expect(d.upcomingDebitOrders[0]!.slug).toBe("salaries");
    expect(d.recent.length).toBeGreaterThan(0);
  });

  it("allocates every delivered shipment's margin through the outbox, matching the settlements", async () => {
    const b = await book();
    const veh = await h.http().post("/v1/admin/fleet/vehicles").set(asStaff()).send({
      registration: "DC 02 GP",
      make: "Toyota",
      model: "Quantum",
      fuelType: "petrol",
      litresPer100Km: 11,
    });
    const d = await h.http().post("/v1/admin/fleet/drivers").set(asStaff()).send({
      email: DRIVER_USER.email,
      fullName: "Thabo Nkosi",
      phone: "0839876543",
      vehicleId: veh.body.id,
      dailyStopCapacity: 10,
    });
    driverId = d.body.id;
    await h
      .http()
      .post("/v1/admin/fleet/shifts")
      .set(asStaff())
      .send({ driverId, date: TODAY })
      .expect(201);
    await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/auto-assign`)
      .set(asStaff())
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
        actualKm: 12.5,
      })
      .expect(201);

    // nothing is allocated until the worker delivers settlement.posted
    expect(await txFor(`shipment:${b.shipments[0]!.id}`)).toHaveLength(0);
    expect(await h.dispatcher.tick()).toBeGreaterThan(0);

    const settlement = (
      await h
        .http()
        .get(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/settlement`)
        .set(asStaff())
    ).body.settlement as Settlement;
    const rows = await txFor(`shipment:${b.shipments[0]!.id}`);
    expect(rows.length).toBeGreaterThan(0);
    // THE reconciliation rule: a settlement's allocation lines sum to its contribution margin
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(settlement.marginCents);

    // a replay of the event changes nothing
    await h.dispatcher.tick();
    const again = await txFor(`shipment:${b.shipments[0]!.id}`);
    expect(again.reduce((s, r) => s + r.amountCents, 0)).toBe(settlement.marginCents);

    // and the wallet balances still tie back to the transaction log
    const bySlug = await walletsBySlug();
    const ledgerTotal = (await h.db.db.select().from(allocationTransactions)).reduce(
      (s, r) => s + r.amountCents,
      0,
    );
    expect(Object.values(bySlug).reduce((s, w) => s + w.balanceCents, 0)).toBe(ledgerTotal);
  });

  it("only finance and super admins may change treasury policy", async () => {
    const dispatcherToken = await h.tokenFor(USERS.bob);
    await h.db.db
      .insert(users)
      .values({ ...USERS.bob, platformRole: "dispatcher" })
      .onConflictDoUpdate({ target: users.id, set: { platformRole: "dispatcher" } });
    await h
      .http()
      .get("/v1/admin/treasury/dashboard")
      .set({ Authorization: `Bearer ${dispatcherToken}` })
      .expect(403);
    const res = await h
      .http()
      .post("/v1/admin/treasury/policy")
      .set(asStaff())
      .send({ urgencyWindowDays: 14, urgencyMaxMultiplierBps: 30_000, reserveGateBps: 9_000 });
    expect(res.status).toBe(201);
    expect((await treasury.policy()).urgencyWindowDays).toBe(14);
  });

  async function book(): Promise<Booking> {
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
    const res = await h.http().post("/v1/account/bookings").set(asOwner()).send({ quoteId: q.id });
    expect(res.status).toBe(201);
    return res.body as Booking;
  }
});
