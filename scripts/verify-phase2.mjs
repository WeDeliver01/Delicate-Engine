/**
 * End-to-end smoke test against a RUNNING engine (api on :8080, worker draining the outbox).
 *
 *   node scripts/verify-phase2.mjs
 *
 * It exercises the whole Phase 1 + 2 chain the way the apps do — quote, book, auto-assign,
 * shift, collect, deliver with POD, settle — and asserts the money that comes out the other
 * end, including that the ledger balances.
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
