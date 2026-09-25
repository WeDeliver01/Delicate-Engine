import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@delicate/db";
import type { AllocationWallet, SettingsBundle } from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { SettingsService } from "../src/infra/settings.service.js";

describe("operator settings", () => {
  let h: Harness;
  let settings: SettingsService;
  let admin: string;
  let finance: string;
  let dispatcher: string;

  beforeAll(async () => {
    h = await createHarness();
    settings = h.app.get(SettingsService);
    admin = await h.tokenFor(USERS.admin);
    finance = await h.tokenFor(USERS.alice);
    dispatcher = await h.tokenFor(USERS.bob);
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    await h.db.db.insert(users).values([
      { ...USERS.admin, platformRole: "super_admin" },
      { ...USERS.alice, platformRole: "finance" },
      { ...USERS.bob, platformRole: "dispatcher" },
    ]);
  });

  const asAdmin = () => ({ Authorization: `Bearer ${admin}` });
  const asFinance = () => ({ Authorization: `Bearer ${finance}` });
  const asDispatcher = () => ({ Authorization: `Bearer ${dispatcher}` });

  const bundle = async (headers = asAdmin()) =>
    (await h.http().get("/v1/admin/settings").set(headers).expect(200)).body as SettingsBundle;

  it("returns every operator-owned number in one typed bundle", async () => {
    const s = await bundle();
    expect(s.company.legalName).toBe("Delicate Courier (Pty) Ltd");
    expect(s.vat).toEqual({ registered: true, bps: 1_500 });
    expect(s.operations.timezone).toBe("Africa/Johannesburg");
    expect(s.settlement.driverEarningPerDropCents).toBeGreaterThan(0);
    expect(s.slots).toBeTruthy();
  });

  it("warns that documents are not tax invoices until the VAT number is filled in", async () => {
    const s = await bundle();
    // seeded profile has no VAT number but VAT is switched on
    expect(s.readiness.issuesTaxInvoices).toBe(false);
    const blocking = s.readiness.missing.filter((m) => m.severity === "blocking");
    expect(blocking.map((m) => m.field)).toContain("company.vatNumber");

    await h
      .http()
      .put("/v1/admin/settings/company-profile")
      .set(asAdmin())
      .send({ ...s.company, vatNumber: "4123456789", registrationNumber: "2019/123456/07" })
      .expect(200);

    const after = await bundle();
    expect(after.readiness.issuesTaxInvoices).toBe(true);
    expect(after.readiness.missing.filter((m) => m.severity === "blocking")).toHaveLength(0);
  });

  it("flags monthly bills that still carry the seeded placeholder amount", async () => {
    const s = await bundle();
    expect(s.readiness.obligationCount).toBe(6);
    expect(s.readiness.placeholderObligationCount).toBe(6);
    expect(s.readiness.missing.map((m) => m.field)).toContain("treasury.obligations");

    // set a real rent figure; the placeholder count drops
    await h
      .http()
      .put("/v1/admin/treasury/wallets/premises")
      .set(asAdmin())
      .send({
        name: "Premises rent",
        category: "operating_expense",
        obligation: { vendor: "Rialto Properties", monthlyAmountCents: 1_275_000, dueDay: 2 },
      })
      .expect(200);

    const after = await bundle();
    expect(after.readiness.placeholderObligationCount).toBe(5);
    const wallets = (await h.http().get("/v1/admin/treasury/wallets").set(asAdmin()))
      .body as AllocationWallet[];
    const rent = wallets.find((w) => w.slug === "premises")!;
    expect(rent.obligation).toEqual({
      vendor: "Rialto Properties",
      monthlyAmountCents: 1_275_000,
      dueDay: 2,
    });
  });

  it("adds a new monthly bill and deactivates one that no longer applies", async () => {
    await h
      .http()
      .put("/v1/admin/treasury/wallets/security")
      .set(asAdmin())
      .send({
        name: "Depot security",
        category: "operating_expense",
        priority: 7,
        obligation: { vendor: "Fidelity", monthlyAmountCents: 185_000, dueDay: 5 },
      })
      .expect(200);

    let wallets = (await h.http().get("/v1/admin/treasury/wallets").set(asAdmin()))
      .body as AllocationWallet[];
    expect(wallets.find((w) => w.slug === "security")?.obligation?.monthlyAmountCents).toBe(
      185_000,
    );

    await h
      .http()
      .put("/v1/admin/treasury/wallets/telecoms")
      .set(asAdmin())
      .send({
        name: "Connectivity & software",
        category: "operating_expense",
        active: false,
        obligation: { vendor: "Various", monthlyAmountCents: 320_000, dueDay: 15 },
      })
      .expect(200);

    wallets = (await h.http().get("/v1/admin/treasury/wallets").set(asAdmin()))
      .body as AllocationWallet[];
    expect(wallets.find((w) => w.slug === "telecoms")?.active).toBe(false);
    // an inactive bill stops counting as an obligation
    expect((await bundle()).readiness.obligationCount).toBe(6); // 6 seeded − telecoms + security
  });

  it("switching VAT off issues plain invoices and stops adding VAT to quotes", async () => {
    await h
      .http()
      .put("/v1/admin/settings/vat")
      .set(asAdmin())
      .send({ registered: false, bps: 1_500 })
      .expect(200);
    const s = await bundle();
    expect(s.vat.registered).toBe(false);
    expect(s.readiness.issuesTaxInvoices).toBe(false);
    expect(await settings.vatBps()).toBe(0);
  });

  it("changing the driver earning rule takes effect but never rewrites a past settlement", async () => {
    const before = (await bundle()).settlement;
    await h
      .http()
      .put("/v1/admin/settings/settlement-rules")
      .set(asAdmin())
      .send({ ...before, driverEarningPerDropCents: 6_000, fuelCostPerKmCents: 145 })
      .expect(200);
    const rules = await settings.get("settlement.rules");
    expect(rules.driverEarningPerDropCents).toBe(6_000);
    expect(rules.fuelCostPerKmCents).toBe(145);
    // snapshotting onto each settlement is what protects history; see dispatch.test.ts
  });

  it("finance can look but not touch; dispatchers cannot look at all", async () => {
    await h.http().get("/v1/admin/settings").set(asFinance()).expect(200);
    await h
      .http()
      .put("/v1/admin/settings/vat")
      .set(asFinance())
      .send({ registered: false, bps: 1_500 })
      .expect(403);
    await h.http().get("/v1/admin/settings").set(asDispatcher()).expect(403);
  });

  it("rejects a malformed tax profile rather than printing nonsense on an invoice", async () => {
    const s = await bundle();
    const res = await h
      .http()
      .put("/v1/admin/settings/company-profile")
      .set(asAdmin())
      .send({ ...s.company, legalName: "", email: "not-an-email" });
    expect(res.status).toBe(422);
  });

  it("audits every change, because these numbers decide what customers are charged", async () => {
    const s = await bundle();
    await h
      .http()
      .put("/v1/admin/settings/company-profile")
      .set(asAdmin())
      .send({ ...s.company, vatNumber: "4999888777" })
      .expect(200);
    const audit = (await h.http().get("/v1/admin/audit?limit=20").set(asAdmin()).expect(200)).body;
    const entry = (audit.items as { action: string; entityId: string; after: unknown }[]).find(
      (a) => a.action === "settings.update" && a.entityId === "company.tax_profile",
    );
    expect(entry).toBeTruthy();
    expect((entry!.after as { vatNumber: string }).vatNumber).toBe("4999888777");
  });
});
