/**
 * End-to-end smoke test against a RUNNING engine (api on :8080, worker draining the outbox).
 *
 *   node scripts/verify.mjs
 *
 * It exercises the whole Phase 1-3 chain the way the apps do — quote, book, auto-assign,
 * shift, collect, deliver with POD, settle, earmark the margin, propose and execute a payout,
 * invoice — and asserts the money that comes out the other end, including that the ledger
 * balances and that nothing pays itself.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const API = process.env.API_URL ?? "http://localhost:8080";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const token = (who) =>
  execSync(`pnpm -s --filter @delicate/api run dev:token ${who}`, { encoding: "utf8" }).trim().split("\n").pop();

async function call(path, { method = "GET", token, account, json } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (account) headers["x-account-id"] = account;
  if (json !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${path}`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body;
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
  console.log(`  ok  ${msg}`);
};
const rands = (c) => `R${(c / 100).toFixed(2)}`;

/**
 * Treasury and invoicing hang off the outbox, so they land a beat after the delivery does.
 * Poll for the effect rather than sleeping a guessed amount.
 */
async function waitFor(what, fn, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`ASSERT: timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
const addr = (formatted, lat, lng, suburb) => ({
  formatted, line1: null, suburb, city: "Pretoria", postalCode: null, country: "ZA",
  location: { lat, lng }, placeId: null,
});

const owner = token("owner");
const admin = token("admin");
const driverEmail = `verify.driver.${Date.now()}@delicatecourier.local`;
// A fresh identity each run: the driver row is linked to whichever user signs in first.
const driverUserId = randomUUID();

console.log("1. accounts & wallet");
const me = await call("/v1/me", { token: owner });
const accountId = me.accounts[0].id;
await call(`/v1/admin/accounts/${accountId}/wallet/adjust`, { method: "POST", token: admin, json: { amountCents: 500_00, reason: "verification float" } });
const wallet0 = await call("/v1/account/wallet", { token: owner, account: accountId });
assert(wallet0.availableCents >= 500_00, `wallet funded (${rands(wallet0.availableCents)} available)`);

console.log("2. fleet");
const vehicle = await call("/v1/admin/fleet/vehicles", { method: "POST", token: admin, json: { registration: `DC ${Math.floor(Math.random() * 900 + 100)} GP`, make: "Toyota", model: "Quantum", fuelType: "petrol", litresPer100Km: 11 } });
const driver = await call("/v1/admin/fleet/drivers", { method: "POST", token: admin, json: { email: driverEmail, fullName: "Verification Driver", phone: "0830000001", vehicleId: vehicle.id, dailyStopCapacity: 20 } });
const driverToken = token(`${driverUserId} ${driverEmail}`);
const driverMe = await call("/v1/driver/me", { token: driverToken });
assert(driverMe.driver.id === driver.id, "driver linked to their login by email");

console.log("3. quote & booking");
const catalog = await call("/v1/public/catalog");
const cake = catalog.packageTypes.find((p) => p.code === "cake_single");
const quote = await call("/v1/account/quotes", {
  method: "POST", token: owner, account: accountId,
  json: {
    serviceLevelCode: "on_demand",
    collection: { address: addr("Honey Bee, Menlyn", -25.7826, 28.2755, "Menlyn"), contact: { name: "Baker", phone: "0821111111", email: null }, instructions: null },
    drops: [{ address: addr("12 Oak St, Centurion", -25.8603, 28.1894, "Centurion"), recipient: { name: "Jane Verify", phone: "0829998888", email: null }, instructions: null, parcels: [{ packageTypeId: cake.id, quantity: 1, weightKg: 3, description: "Cake" }] }],
    options: {},
  },
});
assert(quote.breakdown.totalCents > 0, `quote priced (${rands(quote.breakdown.totalCents)}, ${quote.breakdown.distanceKm} km, via ${quote.distanceProvider})`);
const booking = await call("/v1/account/bookings", { method: "POST", token: owner, account: accountId, json: { quoteId: quote.id } });
assert(booking.status === "confirmed" && booking.shipments.length === 1, `booked ${booking.reference} / ${booking.shipments[0].waybill}`);
const walletHeld = await call("/v1/account/wallet", { token: owner, account: accountId });
assert(
  walletHeld.heldCents - wallet0.heldCents === booking.totalCents,
  `funds reserved for this booking (${rands(booking.totalCents)}; ${rands(walletHeld.heldCents)} held in total)`,
);

console.log("4. assignment");
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
await call("/v1/admin/fleet/shifts", { method: "POST", token: admin, json: { driverId: driver.id, date: today } });
const shipmentId = booking.shipments[0].id;
const assignment = await call(`/v1/admin/dispatch/shipments/${shipmentId}/auto-assign`, { method: "POST", token: admin });
assert(assignment?.driverId === driver.id, `auto-assigned to ${driver.fullName} (${assignment.plannedKm} km planned)`);

console.log("5. driver works the stop");
await call("/v1/driver/shift/start", { method: "POST", token: driverToken, json: { odometerKm: 100000, fuelPct: 80, location: { lat: -25.7826, lng: 28.2755 } } });
const day = await call("/v1/driver/day", { token: driverToken });
assert(day.stops.length === 2 && day.stops[0].kind === "collection", `driver sees ${day.stops.length} stops (collection + drop)`);
await call("/v1/driver/collect", { method: "POST", token: driverToken, json: { bookingId: booking.id, location: { lat: -25.7826, lng: 28.2755 } } });
await call("/v1/driver/location", {
  method: "POST", token: driverToken,
  json: { pings: [
    { location: { lat: -25.7826, lng: 28.2755 }, recordedAt: new Date(Date.now() - 120000).toISOString() },
    { location: { lat: -25.82, lng: 28.23 }, recordedAt: new Date(Date.now() - 60000).toISOString() },
    { location: { lat: -25.8603, lng: 28.1894 }, recordedAt: new Date().toISOString() },
  ] },
});
const delivered = await call("/v1/driver/deliver", { method: "POST", token: driverToken, json: { shipmentId, receivedBy: "Jane Verify", photoDataUrl: PNG, location: { lat: -25.8603, lng: 28.1894 } } });
assert(delivered.shipment.status === "delivered" && delivered.pod.hasPhoto, "delivered with proof of delivery");

console.log("6. money");
const view = await call(`/v1/admin/dispatch/shipments/${shipmentId}/settlement`, { token: admin });
const st = view.settlement;
assert(st, "settlement row written");
assert(st.revenueCents + st.vatCents === booking.totalCents, `customer charged exactly the quote (${rands(st.revenueCents + st.vatCents)})`);
assert(st.marginCents === st.revenueCents - st.fuelCostCents - st.driverEarningCents, `margin reconciles (${rands(st.marginCents)} on ${st.actualKm} km actual)`);
const walletAfter = await call("/v1/account/wallet", { token: owner, account: accountId });
assert(
  walletAfter.heldCents === wallet0.heldCents && walletAfter.balanceCents === wallet0.balanceCents - booking.totalCents,
  `hold captured once (balance ${rands(walletAfter.balanceCents)}, this booking's hold released)`,
);
const driverAfter = await call("/v1/driver/me", { token: driverToken });
assert(driverAfter.owedEarningsCents === st.driverEarningCents, `driver owed ${rands(driverAfter.owedEarningsCents)} earnings`);
assert(driverAfter.owedFuelCents === st.fuelCostCents, `fuel card owed ${rands(driverAfter.owedFuelCents)}`);
const tb = await call("/v1/admin/ledger/trial-balance", { token: admin });
assert(tb.totalCents === 0, "ledger balances to zero");

console.log("7. tracking");
const track = await call(`/v1/public/track/${booking.shipments[0].waybill}`);
assert(track.status === "delivered" && track.timeline.length >= 4, `public tracking shows ${track.timeline.map((t) => t.status).join(" -> ")}`);
assert(!JSON.stringify(track).includes("Jane Verify"), "no recipient PII on the public page");

await call("/v1/driver/shift/end", { method: "POST", token: driverToken, json: { odometerKm: 100042 } });
console.log("\nPHASE 2 VERIFIED: booking -> assignment -> driver -> delivery -> settlement -> balanced books.");

// ── Phase 3: where the margin went, and who gets paid ──────────────────────────────
const finance = token("finance");

console.log("\n8. treasury");
const dash = await call("/v1/admin/treasury/dashboard", { token: finance });
const mine = await waitFor("the worker to allocate this settlement's margin", async () => {
  const tx = await call(`/v1/admin/treasury/transactions?period=${dash.period}&limit=200`, { token: finance });
  const rows = tx.filter((t) => t.reference === `shipment:${shipmentId}`);
  return rows.length > 0 ? rows : null;
});
assert(mine.length > 0, `margin allocated across ${mine.length} wallet(s)`);
assert(
  mine.reduce((a, t) => a + t.amountCents, 0) === st.marginCents,
  `allocation reconciles to the contribution margin exactly (${rands(st.marginCents)})`,
);
assert(
  dash.healthScore >= 0 && dash.healthScore <= 100 && dash.upcomingDebitOrders.length > 0,
  `obligation health ${dash.healthScore}/100, next bill "${dash.upcomingDebitOrders[0].name}" on day ${dash.upcomingDebitOrders[0].dueDay}`,
);

console.log("\n9. payouts (proposed, never paid automatically)");
const payablesBefore = await call("/v1/admin/payments/payables", { token: finance });
assert(
  payablesBefore.driverEarningsOwedCents >= st.driverEarningCents,
  `ledger says ${rands(payablesBefore.driverEarningsOwedCents)} is owed to drivers`,
);
const proposals = await call("/v1/admin/payments/runs", {
  method: "POST", token: finance,
  json: { kind: "driver_earnings_payout", driverId: driver.id },
});
assert(proposals.length === 1 && proposals[0].status === "proposed", `proposed ${proposals[0]?.reference} for ${rands(proposals[0]?.amountCents)}`);
const proposal = proposals[0];
assert(proposal.journalId === null, "proposing posts nothing to the books");
const refused = await fetch(`${API}/v1/admin/payments/proposals/${proposal.id}/execute`, {
  method: "POST",
  headers: { authorization: `Bearer ${finance}`, "content-type": "application/json" },
  body: JSON.stringify({ externalReference: "SHOULD-NOT-WORK" }),
});
assert(refused.status === 409, "an unapproved proposal cannot be executed");
await call(`/v1/admin/payments/proposals/${proposal.id}/approve`, { method: "POST", token: finance, json: { note: "verification run" } });
const paid = await call(`/v1/admin/payments/proposals/${proposal.id}/execute`, {
  method: "POST", token: finance, json: { externalReference: `VERIFY-${Date.now()}` },
});
assert(paid.status === "executed" && paid.journalId, "journal posted only once a human recorded the payment");
const driverPaid = await call("/v1/driver/me", { token: driverToken });
assert(driverPaid.owedEarningsCents === 0, "driver is square");

console.log("\n10. invoicing");
const invoice = await waitFor("the worker to issue the invoice", async () => {
  const invoices = await call("/v1/account/billing/invoices", { token: owner, account: accountId });
  return invoices.find((i) => i.bookingId === booking.id) ?? null;
});
assert(invoice, `invoice ${invoice.number} issued for the booking`);
assert(invoice.netCents + invoice.vatCents === invoice.totalCents, "invoice adds up");
assert(invoice.totalCents === booking.totalCents, `invoice total matches the quote (${rands(invoice.totalCents)})`);
assert(invoice.outstandingCents === 0, "prepaid invoice is born paid");
assert(invoice.supplier.legalName?.length > 0, `supplier identity snapshotted (${invoice.supplier.legalName})`);
const statement = await call("/v1/account/billing/statement?from=2000-01-01&to=2100-01-01", { token: owner, account: accountId });
assert(
  statement.closingBalanceCents === walletAfter.balanceCents,
  `statement closes on the wallet balance (${rands(statement.closingBalanceCents)})`,
);

console.log("\n11. the books after all of that");
const tbFinal = await call("/v1/admin/ledger/trial-balance", { token: admin });
assert(tbFinal.totalCents === 0, "ledger balances to zero");

console.log("\nPHASE 3 VERIFIED: margin earmarked -> payout proposed -> human executed -> invoiced -> balanced books.");
