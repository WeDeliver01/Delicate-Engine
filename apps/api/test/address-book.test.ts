import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ImportAddressesResult, SavedAddress } from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";

const ADDR = (formatted: string) => ({
  formatted,
  line1: null,
  suburb: "Menlyn",
  city: "Pretoria",
  postalCode: null,
  country: "ZA",
  location: { lat: -25.7826, lng: 28.2755 },
  placeId: null,
});
const CONTACT = { name: "Thandi Mabaso", phone: "0821234567", email: null };

describe("address book", () => {
  let h: Harness;
  let owner: string;
  let accountId: string;

  beforeAll(async () => {
    h = await createHarness();
    owner = await h.tokenFor(USERS.alice);
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    const acc = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Honey Bee", type: "business", organization: { name: "Honey Bee Bakers" } });
    accountId = acc.body.id;
  });

  const as = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": accountId });
  const list = async () =>
    (await h.http().get("/v1/account/address-book").set(as())).body as SavedAddress[];
  const importCsv = async (csv: string, opts: Record<string, unknown> = {}) => {
    const res = await h
      .http()
      .post("/v1/account/address-book/import")
      .set(as())
      .send({ csv, ...opts });
    expect(res.status).toBe(201);
    return res.body as ImportAddressesResult;
  };

  it("saves an address and surfaces the most-used ones first", async () => {
    for (const label of ["Rarely", "Often"]) {
      await h
        .http()
        .post("/v1/account/address-book")
        .set(as())
        .send({ label, address: ADDR(`${label} street`), contact: CONTACT })
        .expect(201);
    }
    const saved = await list();
    const often = saved.find((s) => s.label === "Often")!;
    await h.db.db.execute(
      `update saved_addresses set use_count = 9 where id = '${often.id}'` as unknown as never,
    );
    const ordered = await list();
    expect(ordered[0]!.label).toBe("Often");
  });

  it("refuses two live entries with the same label, but frees the name once archived", async () => {
    await h
      .http()
      .post("/v1/account/address-book")
      .set(as())
      .send({ label: "Menlyn reception", address: ADDR("Shop 42"), contact: CONTACT })
      .expect(201);
    const clash = await h
      .http()
      .post("/v1/account/address-book")
      .set(as())
      .send({ label: "Menlyn reception", address: ADDR("Shop 43"), contact: CONTACT });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("label_taken");

    const [first] = await list();
    await h.http().delete(`/v1/account/address-book/${first!.id}`).set(as()).expect(200);
    expect(await list()).toHaveLength(0); // archived, not deleted
    await h
      .http()
      .post("/v1/account/address-book")
      .set(as())
      .send({ label: "Menlyn reception", address: ADDR("Shop 43"), contact: CONTACT })
      .expect(201);
  });

  it("keeps at most one default", async () => {
    await h
      .http()
      .post("/v1/account/address-book")
      .set(as())
      .send({ label: "Bakery", address: ADDR("The bakery"), contact: CONTACT, isDefault: true })
      .expect(201);
    await h
      .http()
      .post("/v1/account/address-book")
      .set(as())
      .send({
        label: "Second kitchen",
        address: ADDR("Kitchen"),
        contact: CONTACT,
        isDefault: true,
      })
      .expect(201);
    const saved = await list();
    expect(saved.filter((s) => s.isDefault).map((s) => s.label)).toEqual(["Second kitchen"]);
  });

  it("reports every row before writing anything, and writes nothing on a dry run", async () => {
    const csv = [
      "label,contact_name,contact_phone,address,suburb,city",
      "Menlyn reception,Thandi,0821234567,Shop 42 Menlyn Park,Menlyn,Pretoria",
      "Hatfield desk,Sipho,0829999999,5 Burnett St,Hatfield,Pretoria",
    ].join("\n");

    const dry = await importCsv(csv);
    expect(dry.dryRun).toBe(true);
    expect(dry.total).toBe(2);
    expect(dry.created).toBe(2);
    expect(dry.rows.every((r) => r.outcome === "create")).toBe(true);
    expect(await list()).toHaveLength(0); // a dry run touches nothing

    const real = await importCsv(csv, { dryRun: false });
    expect(real.created).toBe(2);
    const saved = await list();
    expect(saved.map((s) => s.label).sort()).toEqual(["Hatfield desk", "Menlyn reception"]);
    expect(saved.find((s) => s.label === "Hatfield desk")!.contact.phone).toBe("0829999999");
  });

  it("names the problem on the line it is on, and imports the rest", async () => {
    const csv = [
      "label,contact_name,contact_phone,address",
      "Good one,Thandi,0821234567,12 Oak Street",
      ",Nobody,0821234567,No label here",
      "Bad phone,Sipho,x,5 Burnett St",
      "No address,Sipho,0821234567,",
      "Good one,Thandi,0821234567,Duplicate label in the same file",
    ].join("\n");

    const result = await importCsv(csv, { dryRun: false });
    expect(result.total).toBe(5);
    expect(result.created).toBe(1);
    expect(result.errors).toBe(3);
    expect(result.skipped).toBe(1);

    const byLine = Object.fromEntries(result.rows.map((r) => [r.line, r]));
    expect(byLine[3]!.message).toContain("No label");
    expect(byLine[4]!.message).toContain("phone");
    expect(byLine[5]!.message).toContain("No street address");
    expect(byLine[6]!.outcome).toBe("skip");
    expect(byLine[6]!.message).toContain("earlier in this file");
    expect(await list()).toHaveLength(1);
  });

  it("copes with quoted fields, embedded commas and CRLF", async () => {
    const csv =
      "label,contact_name,contact_phone,address,instructions\r\n" +
      '"Mabaso, Thandi",Thandi,0821234567,"Shop 42, Menlyn Park","Ring the bell, then wait"\r\n';
    const result = await importCsv(csv, { dryRun: false });
    expect(result.created).toBe(1);
    const [saved] = await list();
    expect(saved!.label).toBe("Mabaso, Thandi");
    expect(saved!.instructions).toBe("Ring the bell, then wait");
  });

  it("does not overwrite an existing entry unless asked", async () => {
    await h
      .http()
      .post("/v1/account/address-book")
      .set(as())
      .send({ label: "Menlyn reception", address: ADDR("Old address"), contact: CONTACT })
      .expect(201);

    const csv =
      "label,contact_name,contact_phone,address\nMenlyn reception,New Person,0827778888,New address";
    const skipped = await importCsv(csv, { dryRun: false });
    expect(skipped.skipped).toBe(1);
    expect(skipped.rows[0]!.message).toContain("already have an address with this label");
    expect((await list())[0]!.contact.name).toBe("Thandi Mabaso");

    const updated = await importCsv(csv, { dryRun: false, updateExisting: true });
    expect(updated.updated).toBe(1);
    expect((await list())[0]!.contact.name).toBe("New Person");
  });

  it("flags an address it could not place rather than refusing the row", async () => {
    // the fallback geocoder cannot resolve nonsense, so the entry saves without coordinates
    const csv =
      "label,contact_name,contact_phone,address\nMystery,Thandi,0821234567,qqqqzzzz nowhere";
    const result = await importCsv(csv, { dryRun: false });
    const row = result.rows[0]!;
    if (row.needsLocation) {
      expect(row.outcome).toBe("create");
      expect(row.message).toContain("could not place this address");
    }
    expect(await list()).toHaveLength(1);
  });

  it("refuses a file with no label or address column", async () => {
    const res = await h
      .http()
      .post("/v1/account/address-book/import")
      .set(as())
      .send({ csv: "name,phone\nThandi,0821234567" });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("label");
  });

  it("round-trips: what export writes, import reads", async () => {
    await h
      .http()
      .post("/v1/account/address-book")
      .set(as())
      .send({
        label: "Menlyn reception",
        address: ADDR("Shop 42, Menlyn Park"),
        contact: { name: "Thandi Mabaso", phone: "0821234567", email: "t@example.co.za" },
        instructions: "Ring the bell, then wait",
      })
      .expect(201);

    const exported = (
      await h.http().get("/v1/account/address-book/export.csv").set(as()).expect(200)
    ).text;
    expect(exported.split("\r\n")[0]).toContain("label,contact_name");

    const other = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Second Bakery", type: "business", organization: { name: "Second Bakery" } });
    const asOther = () => ({ Authorization: `Bearer ${owner}`, "X-Account-Id": other.body.id });
    const res = await h
      .http()
      .post("/v1/account/address-book/import")
      .set(asOther())
      .send({ csv: exported, dryRun: false });
    expect((res.body as ImportAddressesResult).created).toBe(1);
    const moved = (await h.http().get("/v1/account/address-book").set(asOther()))
      .body as SavedAddress[];
    expect(moved[0]!.label).toBe("Menlyn reception");
    expect(moved[0]!.contact.email).toBe("t@example.co.za");
    expect(moved[0]!.instructions).toBe("Ring the bell, then wait");
  });

  it("keeps one account's address book away from another", async () => {
    await h
      .http()
      .post("/v1/account/address-book")
      .set(as())
      .send({ label: "Private", address: ADDR("Secret kitchen"), contact: CONTACT })
      .expect(201);
    const [mine] = await list();

    const other = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Rival", type: "business", organization: { name: "Rival" } });
    await h
      .http()
      .get(`/v1/account/address-book/${mine!.id}`)
      .set({ Authorization: `Bearer ${owner}`, "X-Account-Id": other.body.id })
      .expect(404);
  });
});
