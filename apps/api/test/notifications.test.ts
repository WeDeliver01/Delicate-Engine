import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, memberships, notifications as notificationsTable, users } from "@delicate/db";
import type {
  Booking,
  CatalogResponse,
  Driver,
  Notification,
  NotificationChannelStatus,
  NotificationPreferences,
  NotificationTemplate,
  Quote,
} from "@delicate/contracts";
import { createHarness, USERS, type Harness } from "./harness.js";
import { WalletService } from "../src/modules/wallet/wallet.service.js";
import { NotificationService } from "../src/modules/notifications/notification.service.js";
import { Clock } from "../src/infra/clock.js";
import {
  NOTIFICATION_TRANSPORTS,
  type NotificationTransport,
  type OutboundMessage,
} from "../src/modules/notifications/transports/transport.js";

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
  id: "10000000-0000-4000-8000-000000000024",
  email: "kagiso@delicatecourier.local",
};

describe("notifications", () => {
  let h: Harness;
  let wallet: WalletService;
  let service: NotificationService;
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
    service = h.app.get(NotificationService);
    h.app.get(Clock).now = () => new Date("2026-09-23T07:00:00Z");
    owner = await h.tokenFor(USERS.alice);
    staff = await h.tokenFor(USERS.admin);
    driverToken = await h.tokenFor(DRIVER_USER);
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    await service.seedTemplates();
    await h.db.db.insert(users).values({ ...USERS.admin, platformRole: "super_admin" });
    const acc = await h
      .http()
      .post("/v1/accounts")
      .set("Authorization", `Bearer ${owner}`)
      .send({ name: "Honey Bee", type: "business", organization: { name: "Honey Bee Bakers" } });
    accountId = acc.body.id;
    // an email on file, otherwise everything is suppressed for lack of an address
    await h.db.db
      .update(accounts)
      .set({ billingEmail: "orders@honeybee.local" })
      .where(eq(accounts.id, accountId));
    await wallet.adjust(accountId, 500_000, "test funds");
    cakeId = ((await h.http().get("/v1/public/catalog")).body as CatalogResponse).packageTypes.find(
      (p) => p.code === "cake_single",
    )!.id;

    const veh = await h.http().post("/v1/admin/fleet/vehicles").set(asStaff()).send({
      registration: "DC 05 GP",
      make: "Toyota",
      model: "Quantum",
      fuelType: "petrol",
      litresPer100Km: 11,
    });
    driver = (
      await h.http().post("/v1/admin/fleet/drivers").set(asStaff()).send({
        email: DRIVER_USER.email,
        fullName: "Kagiso Molefe",
        phone: "0843332222",
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

  const sent = async () =>
    (await h.http().get("/v1/admin/notifications?limit=100").set(asStaff())).body as Notification[];
  const rawRows = () => h.db.db.select().from(notificationsTable);

  async function book(recipientEmail: string | null = null): Promise<Booking> {
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
              recipient: { name: "Jane", phone: "0821234567", email: recipientEmail },
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

  it("writes a message the moment a booking is confirmed, rendered from the template", async () => {
    const b = await book();
    expect(await rawRows()).toHaveLength(0); // nothing until the worker delivers the event
    await h.dispatcher.tick();

    const rows = await sent();
    const confirm = rows.find((n) => n.kind === "booking.confirmed")!;
    expect(confirm).toBeTruthy();
    expect(confirm.channel).toBe("email");
    expect(confirm.subject).toBe(`Booking ${b.reference} confirmed`);
    expect(confirm.body).toContain("Honey Bee");
    // no unrendered placeholders ever reach a customer
    expect(confirm.body).not.toMatch(/\{\{|\}\}/);

    /*
      The waybill is no longer in the prose -- it is in the consignment, which the layout
      prints as a table and the text part appends. Listing it in both is how a confirmation
      starts reading like a receipt printer, so what matters is that it is carried, not where.
    */
    const [raw] = await h.db.db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.id, confirm.id));
    const { consignment } = raw!.payload as {
      consignment: { waybill: string; destination: string; contents: string }[];
    };
    expect(consignment).toHaveLength(b.shipments.length);
    expect(consignment[0]!.waybill).toBe(b.shipments[0]!.waybill);
    expect(consignment[0]!.destination).toBe("Centurion");
    // "1 x Single-tier cake" — the catalog's own name, counted.
    expect(consignment[0]!.contents).toMatch(/^1 x .*cake/i);
  });

  it("redacts contact details in the admin list", async () => {
    await book();
    await h.dispatcher.tick();
    const rows = await sent();
    expect(rows[0]!.to).toBe("or••••@honeybee.local");
    expect(rows[0]!.to).not.toContain("orders@");
  });

  it("tells the recipient their parcel is on the way, and the customer when it lands", async () => {
    const b = await book();
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
    await h.dispatcher.tick();

    // Collecting a booking says nothing about when any one parcel is on its way: a van with
    // twelve drops collected them all at nine. The driver marks the parcel out for delivery
    // when it is the one they are driving to, and that is what tells the person waiting.
    expect((await sent()).find((n) => n.kind === "shipment.out_for_delivery")).toBeUndefined();
    await h
      .http()
      .post("/v1/driver/status")
      .set(asDriver())
      .send({ shipmentId: b.shipments[0]!.id, status: "out_for_delivery" })
      .expect(201);
    await h.dispatcher.tick();

    let rows = await sent();
    const toRecipient = rows.find((n) => n.kind === "shipment.out_for_delivery")!;
    expect(toRecipient.audience).toBe("recipient");
    expect(toRecipient.channel).toBe("sms");
    expect(toRecipient.body).toContain("Jane");
    expect(toRecipient.body).toContain("Kagiso Molefe");
    // no SMS provider is configured yet, so it is recorded and suppressed rather than lost
    expect(toRecipient.status).toBe("suppressed");
    expect(toRecipient.detail).toContain("No sms provider is configured");

    await h
      .http()
      .post("/v1/driver/deliver")
      .set(asDriver())
      .send({ shipmentId: b.shipments[0]!.id, receivedBy: "Jane", photoDataUrl: PNG, actualKm: 14 })
      .expect(201);
    await h.dispatcher.tick();

    rows = await sent();
    const delivered = rows.filter((n) => n.kind === "shipment.delivered");
    // The recipient's email row is written even though this recipient gave no address —
    // suppressed with its reason, which is the record that we had no way to reach them.
    expect(delivered.map((d) => `${d.audience}/${d.channel}`).sort()).toEqual([
      "customer/email",
      "recipient/email",
      "recipient/sms",
    ]);
    expect(delivered.find((d) => d.audience === "customer")!.body).toContain("signed for by Jane");
  });

  /**
   * Drive one parcel from booking to delivered, with the proof captured at the door.
   *
   * `location` is passed because a phone that refused the location permission is the ordinary
   * case and the email still has to go out; the tests that care give one.
   */
  async function deliverOne(recipientEmail: string | null, location: typeof CENTURION | null) {
    const b = await book(recipientEmail);
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
        actualKm: 14,
        location,
        note: "handed over at the front desk",
      })
      .expect(201);
    for (let i = 0; i < 4; i++) await h.dispatcher.tick();
    return b;
  }

  it("emails the proof of delivery to the recipient as well, when they gave an address", async () => {
    await deliverOne("jane@example.local", CENTURION);

    const delivered = (await rawRows()).filter((r) => r.kind === "shipment.delivered");
    const addressed = delivered.map((d) => `${d.audience}/${d.channel}`).sort();
    expect(addressed).toEqual(["customer/email", "recipient/email", "recipient/sms"]);

    // Per channel, so the mail goes to the inbox and the text to the mobile. One address for
    // both would have handed a phone number to the mail host.
    const email = delivered.find((d) => d.audience === "recipient" && d.channel === "email")!;
    const sms = delivered.find((d) => d.audience === "recipient" && d.channel === "sms")!;
    expect(email.toAddress).toBe("jane@example.local");
    expect(sms.toAddress).toBe("0821234567");
    expect(email.body).toContain("received by Jane");
    expect(email.body).not.toMatch(/\{\{|\}\}/);

    // What the layout needs to show the proof, stamped at the time it happened.
    const proof = (email.payload as { proof: Record<string, unknown> }).proof;
    expect(proof).toMatchObject({
      receivedBy: "Jane",
      at: CENTURION,
      note: "handed over at the front desk",
    });
    expect(proof.photoFileId).toBeTruthy();
  });

  it("sends the recipient the text alone when they gave no email address", async () => {
    await deliverOne(null, CENTURION);

    const delivered = (await rawRows()).filter(
      (r) => r.kind === "shipment.delivered" && r.audience === "recipient",
    );
    const email = delivered.find((d) => d.channel === "email")!;
    // Written down, not discarded: a suppression with a reason is the record that we had no
    // way to reach them. Nobody is made to hand over an email to receive a parcel.
    expect(email.status).toBe("suppressed");
    expect(email.detail).toContain("No email address on file");
    expect(delivered.find((d) => d.channel === "sms")!.toAddress).toBe("0821234567");
  });

  it("attaches the photograph inline and links the place, rather than embedding either", async () => {
    // A recording transport in place of SMTP, which is not configured here. Swapped into the
    // injected array so the dispatcher's own lookup finds it.
    const transports = h.app.get<NotificationTransport[]>(NOTIFICATION_TRANSPORTS);
    const captured: OutboundMessage[] = [];
    const index = transports.findIndex((t) => t.channel === "email");
    const real = transports[index]!;
    transports[index] = {
      channel: "email",
      provider: "recorder",
      status: () => ({ configured: true, detail: null }),
      send: async (message: OutboundMessage) => {
        captured.push(message);
        return { providerMessageId: "recorded" };
      },
    };
    try {
      await deliverOne("jane@example.local", CENTURION);
      await service.dispatchDue(50);
    } finally {
      transports[index] = real;
    }

    const toRecipient = captured.find((m) => m.to === "jane@example.local")!;
    expect(toRecipient).toBeTruthy();

    // `cid:` and not `data:`: Gmail and Outlook both strip a data URI, so the inline
    // attachment is the only form that renders for everyone.
    expect(toRecipient.html).toContain('src="cid:pod"');
    expect(toRecipient.html).not.toContain("data:image");
    const photo = toRecipient.attachments?.find((a) => a.cid === "pod")!;
    expect(photo).toBeTruthy();
    expect(photo.contentType).toBe("image/png");
    expect(photo.content.length).toBeGreaterThan(0);

    // A link to a map, not a picture of one: a static map costs an API call per email.
    const mapUrl = `query=${CENTURION.lat},${CENTURION.lng}`;
    expect(toRecipient.html).toContain(mapUrl);
    // The text part carries the same facts for a client that will not render HTML.
    expect(toRecipient.body).toContain("Proof of delivery");
    expect(toRecipient.body).toContain("A photograph taken at the door is attached.");
    expect(toRecipient.body).toContain(mapUrl);

    // The customer's copy gets its own attachment rather than a link back to ours. Matched on
    // the subject, because every other email of this run also went to that address.
    const toCustomer = captured.find(
      (m) => m.to === "orders@honeybee.local" && m.subject?.endsWith("delivered"),
    )!;
    expect(toCustomer, captured.map((m) => m.subject).join(" | ")).toBeTruthy();
    expect(toCustomer.attachments?.some((a) => a.cid === "pod")).toBe(true);
    expect(toCustomer.html).toContain('src="cid:pod"');
  });

  it("never messages the same person twice for the same event", async () => {
    await book();

    // Drain first. One booking now sets several events going — the account it was placed on,
    // the booking itself, the driver it was assigned to — and the outbox hands them over a few
    // at a time, so a single tick is not the whole story. Ticking until it goes quiet is what
    // "everything has been delivered" actually means.
    let previous = -1;
    for (let i = 0; i < 10 && (await rawRows()).length !== previous; i++) {
      previous = (await rawRows()).length;
      await h.dispatcher.tick();
    }

    const settled = await rawRows();
    expect(settled.length).toBeGreaterThan(0);

    // The guarantee: one message per person per thing that happened. Redelivering every event
    // must not add a row, and no two rows may address the same audience on the same channel
    // about the same event.
    await h.dispatcher.tick();
    await h.dispatcher.tick();
    const after = await rawRows();
    expect(after.length).toBe(settled.length);

    const addressed = after.map((r) => `${r.kind}/${r.audience}/${r.channel}`);
    expect(new Set(addressed).size).toBe(addressed.length);
  });

  it("does not send a recipient both an SMS and a WhatsApp saying the same thing", async () => {
    // Two instant messages about one parcel is the same person being told twice, and the
    // person it lands on is a recipient who never asked us for either.
    const templates = (await h.http().get("/v1/admin/notifications/templates").set(asStaff()))
      .body as NotificationTemplate[];
    const both = templates.filter(
      (t) => t.kind === "shipment.out_for_delivery" && t.audience === "recipient",
    );
    expect(both.map((t) => t.channel).sort()).toEqual(["sms", "whatsapp"]);

    await book();
    for (let i = 0; i < 6; i++) await h.dispatcher.tick();

    const instant = (await rawRows()).filter(
      (r) => r.audience === "recipient" && (r.channel === "sms" || r.channel === "whatsapp"),
    );
    const perEvent = new Map<string, number>();
    for (const row of instant) {
      perEvent.set(row.kind, (perEvent.get(row.kind) ?? 0) + 1);
    }
    for (const [kind, count] of perEvent) {
      expect(count, `${kind} reached the recipient ${count} times`).toBe(1);
    }
  });

  it("suppresses with a reason instead of sending, when there is nowhere to send", async () => {
    await book();
    // No billing address and no owner to fall back to: the only state with genuinely nobody
    // to write to. Addressing happens when the handler runs, so this counts.
    await h.db.db.update(accounts).set({ billingEmail: null }).where(eq(accounts.id, accountId));
    await h.db.db.delete(memberships).where(eq(memberships.accountId, accountId));
    await h.dispatcher.tick();
    const confirm = (await sent()).find((n) => n.kind === "booking.confirmed")!;
    expect(confirm.status).toBe("suppressed");
    expect(confirm.detail).toBe("No email address on file for this recipient.");
  });

  it("honours an account that has opted out", async () => {
    await h
      .http()
      .put("/v1/account/notifications/preferences")
      .set(asOwner())
      .send({ email: false })
      .expect(200);
    const prefs = (await h.http().get("/v1/account/notifications/preferences").set(asOwner()))
      .body as NotificationPreferences;
    expect(prefs.email).toBe(false);

    await book();
    await h.dispatcher.tick();
    const confirm = (await sent()).find((n) => n.kind === "booking.confirmed")!;
    expect(confirm.status).toBe("suppressed");
    expect(confirm.detail).toBe("The account has opted out of email.");
  });

  it("does not contact recipients when the account asks us not to", async () => {
    await h
      .http()
      .put("/v1/account/notifications/preferences")
      .set(asOwner())
      .send({ notifyRecipients: false })
      .expect(200);
    const b = await book();
    await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/auto-assign`)
      .set(asStaff());
    await h.http().post("/v1/driver/collect").set(asDriver()).send({ bookingId: b.id });
    await h
      .http()
      .post("/v1/driver/status")
      .set(asDriver())
      .send({ shipmentId: b.shipments[0]!.id, status: "out_for_delivery" })
      .expect(201);
    await h.dispatcher.tick();

    const toRecipient = (await sent()).find((n) => n.kind === "shipment.out_for_delivery")!;
    expect(toRecipient.status).toBe("suppressed");
    expect(toRecipient.detail).toBe("The account has asked us not to contact their recipients.");
  });

  it("hands an SMS back to the driver when no provider is configured, and records it either way", async () => {
    const b = await book();
    await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/auto-assign`)
      .set(asStaff())
      .expect(201);
    await h.http().post("/v1/driver/collect").set(asDriver()).send({ bookingId: b.id }).expect(201);

    const res = await h
      .http()
      .post("/v1/driver/notify")
      .set(asDriver())
      .send({ shipmentId: b.shipments[0]!.id, target: "recipient", channel: "sms", eta: 10 });
    expect(res.status).toBe(201);
    // No Twilio credentials in the test environment, so the driver sends it themselves.
    expect(res.body.delivery).toBe("driver");
    expect(res.body.to).toBe("0821234567");
    expect(res.body.text).toContain("is about 10 minutes away");
    expect(res.body.text).toContain("Jane");
    expect(res.body.reason).toContain("SMS_PROVIDER");
    // Written down regardless: a driver's claim that they said they were coming is worth a
    // record, and the console counts what it could not send.
    await h.dispatcher.tick();
    const recorded = (await sent()).find((n) => n.kind === "shipment.driver_arriving")!;
    expect(recorded.status).toBe("suppressed");

    // "I have arrived" is a different thing to say, so it is not deduped against the first.
    const arrived = await h.http().post("/v1/driver/notify").set(asDriver()).send({
      shipmentId: b.shipments[0]!.id,
      target: "recipient",
      channel: "sms",
      eta: "arrived",
    });
    expect(arrived.body.text).toContain("has arrived");
  });

  it("will not route an opt-out through the driver's phone", async () => {
    // The gap the fallback closes is ours: no provider. An account that asked us not to
    // contact their recipients has made a decision, and handing the driver the words to send
    // anyway would be going round it.
    await h
      .http()
      .put("/v1/account/notifications/preferences")
      .set(asOwner())
      .send({ notifyRecipients: false })
      .expect(200);
    const b = await book();
    await h
      .http()
      .post(`/v1/admin/dispatch/shipments/${b.shipments[0]!.id}/auto-assign`)
      .set(asStaff())
      .expect(201);
    await h.http().post("/v1/driver/collect").set(asDriver()).send({ bookingId: b.id }).expect(201);

    const res = await h
      .http()
      .post("/v1/driver/notify")
      .set(asDriver())
      .send({ shipmentId: b.shipments[0]!.id, target: "recipient", channel: "sms", eta: 5 });
    expect(res.body.delivery).toBe("suppressed");
    expect(res.body.reason).toBe("The account has asked us not to contact their recipients.");
  });

  it("will not let a driver message about a shipment that is not theirs", async () => {
    const b = await book();
    const res = await h
      .http()
      .post("/v1/driver/notify")
      .set(asDriver())
      .send({ shipmentId: b.shipments[0]!.id, target: "recipient", channel: "sms", eta: 5 });
    expect(res.status).toBe(403);
  });

  it("reports which channels are actually wired up", async () => {
    await book();
    await h.dispatcher.tick();
    const channels = (await h.http().get("/v1/admin/notifications/channels").set(asStaff()))
      .body as NotificationChannelStatus[];
    const email = channels.find((c) => c.channel === "email")!;
    const sms = channels.find((c) => c.channel === "sms")!;

    expect(email.provider).toBe("smtp");
    expect(email.configured).toBe(false); // no SMTP_HOST in tests
    expect(email.detail).toContain("SMTP_HOST");
    expect(sms.configured).toBe(false);
    expect(sms.detail).toContain("Twilio");
    expect(email.suppressed24h).toBeGreaterThan(0);
  });

  it("lets the operator rewrite the copy, and uses their words from then on", async () => {
    const templates = (await h.http().get("/v1/admin/notifications/templates").set(asStaff()))
      .body as NotificationTemplate[];
    const t = templates.find((x) => x.kind === "booking.confirmed" && x.channel === "email")!;

    await h
      .http()
      .put(`/v1/admin/notifications/templates/${t.id}`)
      .set(asStaff())
      .send({
        subject: "Lekker! {{reference}} is booked",
        body: "Hi {{customerName}}, all sorted.",
      })
      .expect(200);

    await book();
    await h.dispatcher.tick();
    const confirm = (await sent()).find((n) => n.kind === "booking.confirmed")!;
    expect(confirm.subject).toMatch(/^Lekker! BK-/);
    expect(confirm.body).toBe("Hi Honey Bee, all sorted.");
  });

  it("stops sending a kind entirely when its template is switched off", async () => {
    const templates = (await h.http().get("/v1/admin/notifications/templates").set(asStaff()))
      .body as NotificationTemplate[];
    const t = templates.find((x) => x.kind === "booking.confirmed" && x.channel === "email")!;
    await h
      .http()
      .put(`/v1/admin/notifications/templates/${t.id}`)
      .set(asStaff())
      .send({ enabled: false })
      .expect(200);

    await book();
    await h.dispatcher.tick();
    const confirm = (await sent()).find((n) => n.kind === "booking.confirmed")!;
    expect(confirm.status).toBe("suppressed");
    expect(confirm.detail).toBe("This template is switched off.");
  });

  it("only a super admin may rewrite the copy customers receive", async () => {
    const dispatcherToken = await h.tokenFor(USERS.carol);
    await h.db.db
      .insert(users)
      .values({ ...USERS.carol, platformRole: "dispatcher" })
      .onConflictDoUpdate({ target: users.id, set: { platformRole: "dispatcher" } });
    const templates = (await h.http().get("/v1/admin/notifications/templates").set(asStaff()))
      .body as NotificationTemplate[];
    await h
      .http()
      .put(`/v1/admin/notifications/templates/${templates[0]!.id}`)
      .set({ Authorization: `Bearer ${dispatcherToken}` })
      .send({ body: "hi" })
      .expect(403);
  });

  it("shows a customer their own message history and nobody else's", async () => {
    await book();
    await h.dispatcher.tick();
    const mine = (await h.http().get("/v1/account/notifications").set(asOwner()))
      .body as Notification[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((n) => n.accountId === accountId)).toBe(true);
  });

  it("marks a message dead rather than retrying it forever", async () => {
    // pretend email is configured so the dispatcher actually attempts a send
    await book();
    await h.dispatcher.tick();
    const [row] = await rawRows();
    await h.db.db
      .update(notificationsTable)
      .set({ status: "queued", maxAttempts: 1, detail: null })
      .where(eq(notificationsTable.id, row!.id));

    await service.dispatchDue();
    const after = await h.db.db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.id, row!.id));
    // no SMTP host in tests, so the attempt fails and the single attempt is exhausted
    expect(after[0]!.status).toBe("dead");
    expect(after[0]!.attempts).toBe(1);
  });

  // ── having somewhere to send at all ───────────────────────────────────────

  describe("who we write to", () => {
    /*
      `accounts.billing_email` was read in two places and written in none, so every message an
      account ever earned was filed as suppressed for having no address -- quietly, because a
      suppressed message is not a failed one. These are the two halves of the fix.
    */
    it("gives a new account the address of whoever created it", async () => {
      const res = await h
        .http()
        .post("/v1/accounts")
        .set("Authorization", `Bearer ${owner}`)
        .send({ name: "Second Shop", type: "business", organization: { name: "Second Shop Ltd" } });
      expect(res.status).toBe(201);

      const row = await h.db.db.query.accounts.findFirst({
        where: eq(accounts.id, res.body.id as string),
      });
      expect(row?.billingEmail).toBe(USERS.alice.email);
    });

    it("welcomes a brand new account instead of suppressing the welcome", async () => {
      const res = await h
        .http()
        .post("/v1/accounts")
        .set("Authorization", `Bearer ${owner}`)
        .send({ name: "Third Shop", type: "business", organization: { name: "Third Shop Ltd" } });
      await h.dispatcher.tick();

      const rows = await h.db.db
        .select()
        .from(notificationsTable)
        .where(eq(notificationsTable.accountId, res.body.id as string));
      const welcome = rows.find((n) => n.kind === "account.created");
      expect(welcome, "a new account should be welcomed").toBeTruthy();
      expect(welcome!.toAddress).toBe(USERS.alice.email);
      // Held only because this environment has no mail host -- never for want of an address.
      expect(welcome!.detail).not.toBe("No email address on file for this recipient.");
    });

    it("falls back to the owner when an older account has no billing address", async () => {
      // Exactly the state every account created before the fix is in.
      await h.db.db.update(accounts).set({ billingEmail: null }).where(eq(accounts.id, accountId));

      await book();
      await h.dispatcher.tick();

      const rows = await rawRows();
      const confirm = rows.find((n) => n.kind === "booking.confirmed")!;
      expect(confirm.toAddress).toBe(USERS.alice.email);
      expect(confirm.detail).not.toBe("No email address on file for this recipient.");
    });
  });

  // ── money and access the customer did not initiate ────────────────────────

  describe("changes made for a customer", () => {
    it("tells them when we adjust their balance, and which way", async () => {
      await wallet.adjust(accountId, -25_000, "damaged in transit refund reversal");
      await h.dispatcher.tick();

      const rows = (await rawRows()).filter((n) => n.kind === "wallet.adjusted");
      // The wallet was also credited in beforeEach, so both adjustments are announced.
      expect(rows).toHaveLength(2);
      const row = rows.find((n) => n.subject?.includes("A deduction"))!;
      expect(row, "the deduction should be announced").toBeTruthy();
      expect(row!.body).toContain("taken");
      expect(row!.body).toContain("from your wallet");
      expect(row!.body).not.toMatch(/\{\{|\}\}/);
    });

    it("tells them when their payment terms change", async () => {
      await h
        .http()
        .put(`/v1/admin/accounts/${accountId}/credit-terms`)
        .set(asStaff())
        .send({ billingMode: "postpaid", creditLimitCents: 500_000 })
        .expect(200);
      await h.dispatcher.tick();

      const row = (await rawRows()).find((n) => n.kind === "account.terms_changed");
      expect(row, "a terms change should be announced").toBeTruthy();
      expect(row!.body).toContain("on account");
      expect(row!.body).not.toMatch(/\{\{|\}\}/);
    });

    it("does not tell an owner they were added to their own account", async () => {
      // membership.granted fires for the first member too, and "you were added to your own
      // account" immediately after the welcome is noise.
      await h.dispatcher.tick();
      const rows = (await rawRows()).filter((n) => n.kind === "account.member_added");
      expect(rows).toHaveLength(0);
    });
  });
});
