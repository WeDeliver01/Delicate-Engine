import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, users } from "@delicate/db";
import type {
  AgeingBucket,
  Booking,
  CatalogResponse,
  Driver,
  Invoice,
  Quote,
  Settlement,
  Statement,
} from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { LedgerService } from "../src/modules/ledger/ledger.service.js";
import { SettingsService } from "../src/infra/settings.service.js";
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
  id: "10000000-0000-4000-8000-000000000023",
  email: "naledi@delicatecourier.local",
};

describe("invoices, credit notes and statements", () => {
  let h: Harness;
  let wallet: WalletService;
  let ledger: LedgerService;
  let settings: SettingsService;
  let owner: string;
  let staff: string;
  let driverToken: string;
  let accountId: string;
  let cakeId: string;
  let driver: Driver;
  const TODAY = "2026-09-23";

  beforeAll(async () => {
    h = await createHarness();
    wallet = h.app.get(WalletService);
    ledger = h.app.get(LedgerService);
    settings = h.app.get(SettingsService);
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z");
    owner = await h.tokenFor(USERS.alice);
    staff = await h.tokenFor(USERS.admin);
    driverToken = await h.tokenFor(DRIVER_USER);
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "super_admin" });
    // a real supplier VAT number, so documents issue as TAX INVOICEs
    const profile = await settings.get("company.tax_profile");
    await settings.set("company.tax_profile", {
      ...profile,
      vatNumber: "4123456789",
      registrationNumber: "2019/123456/07",
    });
    const acc = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Honey Bee", type: "business", organization: { name: "Honey Bee Bakers" } });
    accountId = acc.body.id;
    await wallet.adjust(accountId, 1_000_000, "test funds");
    cakeId = ((await h.http().get("/v1/public/catalog")).body as CatalogResponse).packageTypes.find(
      (p) => p.code === "cake_single",
    )!.id;

    const veh = await h.http().post("/v1/admin/fleet/vehicles").set(asStaff()).send({
      registration: "DC 04 GP",
      make: "Toyota",
      model: "Quantum",
      fuelType: "petrol",
      litresPer100Km: 11,
    });
    driver = (
      await h.http().post("/v1/admin/fleet/drivers").set(asStaff()).send({
        email: DRIVER_USER.email,
        fullName: "Naledi Khumalo",
        phone: "0846667777",
        vehicleId: veh.body.id,
        dailyStopCapacity: 10,
      })
    ).body as Driver;
    await h
      .http()
      .post("/v1/admin/fleet/shifts")
      .set(asStaff())
      .send({ driverId: driver.id, date: TODAY });
  });

  const asOwner = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const asStaff = () => ({ Authorization: `Bearer ${staff}` });
  const asDriver = () => ({ Authorization: `Bearer ${driverToken}` });

  /** Deliver a whole booking so it charges, then drain the outbox so invoicing runs. */
  async function deliverBooking(
    drops = 1,
  ): Promise<{ booking: Booking; settlements: Settlement[] }> {
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
          drops: Array.from({ length: drops }, (_, i) => ({
            address: addr(`${i + 1} Oak St, Centurion`, CENTURION, "Centurion"),
            recipient: { name: `Jane ${i}`, phone: "0821234567", email: null },
            instructions: null,
            parcels: [{ packageTypeId: cakeId, quantity: 1, weightKg: null, description: "Cake" }],
          })),
          options: {},
        })
    ).body as Quote;
    const booking = (
      await h.http().post("/v1/account/bookings").set(asOwner()).send({ quoteId: q.id })
    ).body as Booking;

    for (const s of booking.shipments) {
      await h
        .http()
        .post(`/v1/admin/dispatch/shipments/${s.id}/auto-assign`)
        .set(asStaff())
        .expect(201);
    }
    await h
      .http()
      .post("/v1/driver/shift/start")
      .set(asDriver())
      .send({ odometerKm: 800, fuelPct: 90, location: MENLYN });
    await h
      .http()
      .post("/v1/driver/collect")
      .set(asDriver())
      .send({ bookingId: booking.id, location: MENLYN })
      .expect(201);
    const out: Settlement[] = [];
    for (const s of booking.shipments) {
      await h
        .http()
        .post("/v1/driver/deliver")
        .set(asDriver())
        .send({ shipmentId: s.id, receivedBy: "Jane", photoDataUrl: PNG, actualKm: 15 })
        .expect(201);
      out.push(
        (await h.http().get(`/v1/admin/dispatch/shipments/${s.id}/settlement`).set(asStaff())).body
          .settlement as Settlement,
      );
    }
    await h.dispatcher.tick();
    return { booking, settlements: out };
  }

  const myInvoices = async () =>
    (await h.http().get("/v1/account/billing/invoices").set(asOwner())).body as Invoice[];

  it("issues one tax invoice per charged booking, with a line per drop and VAT shown separately", async () => {
    const { booking, settlements } = await deliverBooking(2);
    const list = await myInvoices();
    expect(list).toHaveLength(1);
    const inv = list[0]!;

    expect(inv.kind).toBe("tax_invoice");
    expect(inv.status).toBe("issued");
    expect(inv.number).toMatch(/^INV-2609-\d{4}$/);
    expect(inv.lines).toHaveLength(2);
    expect(inv.netCents).toBe(settlements.reduce((s, x) => s + x.revenueCents, 0));
    expect(inv.vatCents).toBe(settlements.reduce((s, x) => s + x.vatCents, 0));
    expect(inv.totalCents).toBe(booking.totalCents);
    expect(inv.netCents + inv.vatCents).toBe(inv.totalCents);
    // prepaid: the wallet was already charged, so nothing is outstanding
    expect(inv.outstandingCents).toBe(0);
    expect(inv.journalId).toBeNull(); // revenue was recognised at settlement, not here

    // the supplier identity is snapshotted onto the document
    expect(inv.supplier.vatNumber).toBe("4123456789");
    expect(inv.billTo.legalName).toBe("Honey Bee Bakers");
    expect(inv.lines.every((l) => l.waybill?.startsWith("DC-"))).toBe(true);
  });

  it("does not double-invoice when booking.charged is redelivered", async () => {
    await deliverBooking();
    await h.dispatcher.tick();
    await h.dispatcher.tick();
    expect(await myInvoices()).toHaveLength(1);
  });

  it("issues a plain invoice with no VAT when the company is not VAT registered", async () => {
    await settings.set("company.vat_registered", false);
    const { booking } = await deliverBooking();
    const inv = (await myInvoices())[0]!;
    expect(inv.kind).toBe("invoice");
    expect(inv.vatCents).toBe(0);
    expect(inv.lines.every((l) => l.vatBps === 0)).toBe(true);
    expect(inv.totalCents).toBe(booking.totalCents);
  });

  it("consolidates a postpaid month into one invoice and turns the usage into a receivable", async () => {
    await h.db.db
      .update(accounts)
      .set({ billingMode: "postpaid" })
      .where(eq(accounts.id, accountId));
    await wallet.setCreditTerms(accountId, {
      billingMode: "postpaid",
      creditLimitCents: 5_000_000,
      statementDay: 1,
      paymentTermsDays: 30,
    });

    const { settlements } = await deliverBooking(2);
    // no per-booking invoice for a postpaid account
    expect(await myInvoices()).toHaveLength(0);

    const run = (
      await h
        .http()
        .post("/v1/admin/billing/monthly-runs")
        .set(asStaff())
        .send({ period: "2026-09" })
        .expect(201)
    ).body as Invoice[];
    expect(run).toHaveLength(1);
    const inv = run[0]!;
    expect(inv.period).toBe("2026-09");
    expect(inv.lines).toHaveLength(2);
    expect(inv.totalCents).toBe(settlements.reduce((s, x) => s + x.revenueCents + x.vatCents, 0));
    expect(inv.outstandingCents).toBe(inv.totalCents);
    expect(inv.dueAt).not.toBeNull();
    expect(inv.journalId).not.toBeNull();

    // the debt now lives on the invoice as a receivable, and the wallet is square again
    expect(await ledger.balance("CUSTOMER_RECEIVABLE", "account", accountId)).toBe(inv.totalCents);
    const w = (await h.http().get("/v1/account/wallet").set(asOwner())).body;
    expect(w.balanceCents).toBe(1_000_000);
    expect((await ledger.trialBalance()).totalCents).toBe(0);

    // re-running the month is idempotent
    const again = (
      await h
        .http()
        .post("/v1/admin/billing/monthly-runs")
        .set(asStaff())
        .send({ period: "2026-09" })
    ).body as Invoice[];
    expect(again[0]!.id).toBe(inv.id);
    expect(await ledger.balance("CUSTOMER_RECEIVABLE", "account", accountId)).toBe(inv.totalCents);
  });

  it("records a payment against a postpaid invoice and refuses an overpayment", async () => {
    await h.db.db
      .update(accounts)
      .set({ billingMode: "postpaid" })
      .where(eq(accounts.id, accountId));
    await deliverBooking();
    const inv = (
      (
        await h
          .http()
          .post("/v1/admin/billing/monthly-runs")
          .set(asStaff())
          .send({ period: "2026-09" })
      ).body as Invoice[]
    )[0]!;

    const over = await h
      .http()
      .post(`/v1/admin/billing/invoices/${inv.id}/payments`)
      .set(asStaff())
      .send({ amountCents: inv.totalCents + 1, reference: "EFT-1" });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe("overpayment");

    const part = (
      await h
        .http()
        .post(`/v1/admin/billing/invoices/${inv.id}/payments`)
        .set(asStaff())
        .send({ amountCents: 10_000, reference: "EFT-PART" })
        .expect(201)
    ).body as Invoice;
    expect(part.outstandingCents).toBe(inv.totalCents - 10_000);
    expect(part.status).toBe("issued");

    const rest = (
      await h
        .http()
        .post(`/v1/admin/billing/invoices/${inv.id}/payments`)
        .set(asStaff())
        .send({ amountCents: inv.totalCents - 10_000, reference: "EFT-REST" })
        .expect(201)
    ).body as Invoice;
    expect(rest.status).toBe("paid");
    expect(rest.outstandingCents).toBe(0);
    expect(await ledger.balance("CUSTOMER_RECEIVABLE", "account", accountId)).toBe(0);
    expect((await ledger.trialBalance()).totalCents).toBe(0);
  });

  it("credits a prepaid invoice back to the wallet and reverses the revenue", async () => {
    await deliverBooking();
    const inv = (await myInvoices())[0]!;
    const revenueBefore = await ledger.balance("REVENUE", "company", null);

    const note = (
      await h
        .http()
        .post(`/v1/admin/billing/invoices/${inv.id}/credit-notes`)
        .set(asStaff())
        .send({ reason: "Cake arrived damaged" })
        .expect(201)
    ).body as Invoice;

    expect(note.kind).toBe("credit_note");
    expect(note.number).toMatch(/^CN-2609-\d{4}$/);
    expect(note.totalCents).toBe(-inv.totalCents);
    expect(note.creditsInvoiceId).toBe(inv.id);

    // the original is voided, not edited
    const original = (await h.http().get(`/v1/admin/billing/invoices/${inv.id}`).set(asStaff()))
      .body as Invoice;
    expect(original.status).toBe("void");
    expect(original.creditedByInvoiceId).toBe(note.id);

    // revenue is reversed and the customer has their money back in the wallet
    expect(await ledger.balance("REVENUE", "company", null)).toBe(revenueBefore + inv.netCents);
    // charged at delivery, refunded by the credit note: back where they started
    const w = (await h.http().get("/v1/account/wallet").set(asOwner())).body;
    expect(w.balanceCents).toBe(1_000_000);
    expect((await ledger.trialBalance()).totalCents).toBe(0);

    // and it cannot be credited twice
    const twice = await h
      .http()
      .post(`/v1/admin/billing/invoices/${inv.id}/credit-notes`)
      .set(asStaff())
      .send({ reason: "again" });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe("already_credited");
  });

  it("splits a partial credit into net and VAT so the reversal still balances", async () => {
    await deliverBooking();
    const inv = (await myInvoices())[0]!;
    const note = (
      await h
        .http()
        .post(`/v1/admin/billing/invoices/${inv.id}/credit-notes`)
        .set(asStaff())
        .send({ reason: "Late by 40 minutes", amountCents: 11_500 })
        .expect(201)
    ).body as Invoice;
    expect(note.totalCents).toBe(-11_500);
    expect(note.netCents + note.vatCents).toBe(-11_500);
    expect(note.vatCents).toBe(-1_500); // 15% of 10 000
    const original = (await h.http().get(`/v1/admin/billing/invoices/${inv.id}`).set(asStaff()))
      .body as Invoice;
    expect(original.status).toBe("issued"); // a partial credit does not void the invoice
    expect((await ledger.trialBalance()).totalCents).toBe(0);
  });

  it("derives a statement from the wallet entries, opening to closing", async () => {
    const { booking } = await deliverBooking();
    const st = (
      await h
        .http()
        .get("/v1/account/billing/statement?from=2000-01-01&to=2100-01-01")
        .set(asOwner())
        .expect(200)
    ).body as Statement;

    expect(st.openingBalanceCents).toBe(0);
    expect(st.toppedUpCents).toBe(1_000_000);
    expect(st.chargedCents).toBe(booking.totalCents);
    expect(st.closingBalanceCents).toBe(1_000_000 - booking.totalCents);
    expect(st.deliveries).toBe(1);
    expect(st.invoices).toHaveLength(1);
    // every line's running balance ties back to the one before it
    let running = st.openingBalanceCents;
    for (const l of st.lines) {
      running += l.amountCents;
      expect(l.balanceAfterCents).toBe(running);
    }
    expect(running).toBe(st.closingBalanceCents);
  });

  it("ages what postpaid customers owe and flags anyone over their limit", async () => {
    await h.db.db
      .update(accounts)
      .set({ billingMode: "postpaid" })
      .where(eq(accounts.id, accountId));
    await wallet.setCreditTerms(accountId, {
      billingMode: "postpaid",
      creditLimitCents: 1_000,
      statementDay: 1,
      paymentTermsDays: 0,
    });
    await deliverBooking();
    await h
      .http()
      .post("/v1/admin/billing/monthly-runs")
      .set(asStaff())
      .send({ period: "2026-09" })
      .expect(201);

    // the clock is pinned to 23 September; the invoice fell due on 1 October, so nothing is late
    const ageing = (await h.http().get("/v1/admin/billing/ageing").set(asStaff()))
      .body as AgeingBucket[];
    expect(ageing).toHaveLength(1);
    expect(ageing[0]!.currentCents).toBe(ageing[0]!.totalCents);
    expect(ageing[0]!.overLimit).toBe(true); // owes far more than a R10 limit

    // three months later the same debt is in the 90+ bucket
    h.app.get(Clock).now = () => new Date("2026-12-23T07:00:00Z");
    const later = (await h.http().get("/v1/admin/billing/ageing").set(asStaff()))
      .body as AgeingBucket[];
    expect(later[0]!.days90PlusCents).toBe(later[0]!.totalCents);
    expect(later[0]!.currentCents).toBe(0);
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z");
  });

  it("keeps one account's documents invisible to another", async () => {
    await deliverBooking();
    const inv = (await myInvoices())[0]!;
    const other = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${await h.tokenFor(USERS.bob)}`)
      .send({ name: "Rival Bakes", type: "business", organization: { name: "Rival Bakes" } });
    const bobToken = await h.tokenFor(USERS.bob);
    await h
      .http()
      .get(`/v1/account/billing/invoices/${inv.id}`)
      .set({ Authorization: `Bearer ${bobToken}`, "X-Account-Id": other.body.id })
      .expect(404);
  });
});
