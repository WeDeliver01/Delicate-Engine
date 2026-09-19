// Tests for the canonical status module (`shared/status.ts`) — the single
// source of truth that keeps the Driver App, Ops Portal, Route Planner and
// Dispatch Dashboard in agreement about each stop / shipment's current state.
//
// Run with:  npx tsx tests/status.test.ts
//
// These are pure-function tests (no DB / network) that prove the core
// guarantees of task "status-driven shipment sync":
//   * a driver-completed stop (lowercase) is recognised as done by the
//     dispatcher/route-planner (uppercase) and vice-versa,
//   * skipped/failed stops are treated as closed-out everywhere,
//   * out-of-order lifecycle events never regress a more-advanced status,
//   * terminal shipments are detected so they drop off active route lists,
//   * every producer maps into the one canonical lifecycle vocabulary.

import assert from "node:assert/strict";
import {
  normalizeStopStatus,
  isStopDone,
  isStopFinished,
  isStopActive,
  toDispatchStopStatus,
  toDriverStopStatus,
  rankShipmentStatus,
  isShipmentTerminal,
  isShipmentCollected,
  mapShipLogicToShipmentStatus,
  mapDriverActionToShipmentStatus,
} from "../shared/status";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("shared/status.ts");

// --- per-stop normalisation across both historical vocabularies -------------
test("normalises driver lowercase + dispatcher uppercase to one vocabulary", () => {
  assert.equal(normalizeStopStatus("completed"), "completed");
  assert.equal(normalizeStopStatus("DONE"), "completed");
  assert.equal(normalizeStopStatus("ARRIVED"), "arrived");
  assert.equal(normalizeStopStatus("FAILED"), "failed");
  assert.equal(normalizeStopStatus("delivered"), "completed");
  assert.equal(normalizeStopStatus("collected"), "completed");
  assert.equal(normalizeStopStatus("current"), "arrived");
  assert.equal(normalizeStopStatus(undefined), "pending");
  assert.equal(normalizeStopStatus(""), "pending");
  assert.equal(normalizeStopStatus("  Pending "), "pending");
});

// --- THE core bug: cross-surface recognition --------------------------------
test("a driver-completed stop is recognised as DONE by the dispatcher", () => {
  // driver writes lowercase "completed"; dispatcher/route planner key off DONE.
  assert.equal(toDispatchStopStatus("completed"), "DONE");
  assert.equal(isStopDone("completed"), true);
});

test("a webhook/dispatcher DONE is recognised as completed by the driver app", () => {
  assert.equal(toDriverStopStatus("DONE"), "completed");
  assert.equal(isStopDone("DONE"), true);
});

test("skipped stops are closed-out everywhere (DONE in dispatch view)", () => {
  assert.equal(isStopFinished("skipped"), true);
  assert.equal(isStopActive("skipped"), false);
  assert.equal(toDispatchStopStatus("skipped"), "DONE");
});

test("active vs finished predicates agree across casings", () => {
  for (const active of ["pending", "PENDING", "arrived", "ARRIVED", "current"]) {
    assert.equal(isStopActive(active), true, `${active} should be active`);
    assert.equal(isStopFinished(active), false, `${active} should not be finished`);
  }
  for (const done of ["completed", "DONE", "failed", "FAILED", "skipped", "delivered"]) {
    assert.equal(isStopFinished(done), true, `${done} should be finished`);
    assert.equal(isStopActive(done), false, `${done} should not be active`);
  }
});

// --- shipment lifecycle precedence (out-of-order guard) ----------------------
test("lifecycle rank prevents an out-of-order event regressing status", () => {
  assert.ok(rankShipmentStatus("delivered") > rankShipmentStatus("collected"));
  assert.ok(rankShipmentStatus("out-for-delivery") > rankShipmentStatus("collected"));
  assert.ok(rankShipmentStatus("collected") > rankShipmentStatus("booked"));
  // a late "booked" must not beat an already-delivered shipment
  assert.equal(rankShipmentStatus("booked") >= rankShipmentStatus("delivered"), false);
  // terminal states share the top rank
  assert.equal(rankShipmentStatus("delivered"), rankShipmentStatus("failed"));
  assert.equal(rankShipmentStatus("delivered"), rankShipmentStatus("cancelled"));
});

test("every lifecycle status the producers emit has a real rank (none default to 0)", () => {
  // mapDriverActionToShipmentStatus / mapShipLogicToShipmentStatus must only
  // ever produce statuses that the rank table knows about, otherwise an
  // advanced state silently ranks 0 and a late low-stage event can regress it.
  for (const s of [
    "booked", "submitted", "quote", "collection-assigned", "at-collection",
    "collected", "in-transit", "out-for-delivery", "delivered", "failed",
    "cancelled", "skipped",
  ]) {
    assert.ok(rankShipmentStatus(s) > 0, `${s} must have a non-default rank`);
  }
});

test("at-collection cannot be regressed by a late booked/submitted event", () => {
  assert.ok(rankShipmentStatus("at-collection") > rankShipmentStatus("collection-assigned"));
  assert.ok(rankShipmentStatus("collected") > rankShipmentStatus("at-collection"));
  // a late booking-stage event must NOT overwrite a driver-at-collection state
  assert.equal(rankShipmentStatus("booked") >= rankShipmentStatus("at-collection"), false);
  assert.equal(rankShipmentStatus("submitted") >= rankShipmentStatus("at-collection"), false);
});

test("terminal shipments are detected so they drop off active route lists", () => {
  for (const t of ["delivered", "Delivered", "failed", "cancelled", "returned", "exception", "skipped"]) {
    assert.equal(isShipmentTerminal(t), true, `${t} should be terminal`);
  }
  for (const live of ["booked", "collected", "out-for-delivery", "in-transit", ""]) {
    assert.equal(isShipmentTerminal(live), false, `${live} should not be terminal`);
  }
});

test("skipped shipments are terminal AND ranked so they can't be regressed", () => {
  // skip must be a recognised lifecycle rank (not the default 0), otherwise a
  // later mid-lifecycle event could silently re-open a skipped shipment.
  assert.ok(rankShipmentStatus("skipped") > rankShipmentStatus("collected"));
  assert.equal(rankShipmentStatus("skipped"), rankShipmentStatus("delivered"));
  // a late "booked"/"out-for-delivery" must NOT beat a skipped shipment
  assert.equal(rankShipmentStatus("out-for-delivery") >= rankShipmentStatus("skipped"), false);
  // and it drops from active route lists
  assert.equal(isShipmentTerminal("skipped"), true);
});

// --- producer mapping helpers (one canonical vocabulary) --------------------
test("ShipLogic external statuses map into the canonical lifecycle", () => {
  assert.equal(mapShipLogicToShipmentStatus("Collected"), "collected");
  assert.equal(mapShipLogicToShipmentStatus("Out For Delivery"), "out-for-delivery");
  assert.equal(mapShipLogicToShipmentStatus("in_transit"), "out-for-delivery");
  assert.equal(mapShipLogicToShipmentStatus("Delivered"), "delivered");
  assert.equal(mapShipLogicToShipmentStatus("Delivery Failed"), "failed");
  assert.equal(mapShipLogicToShipmentStatus("Cancelled"), "cancelled");
  // no lifecycle signal -> null (caller ignores rather than regresses)
  assert.equal(mapShipLogicToShipmentStatus("some unknown event"), null);
  assert.equal(mapShipLogicToShipmentStatus(""), null);
});

test("driver actions advance the shipment to the correct lifecycle state", () => {
  assert.equal(mapDriverActionToShipmentStatus("arrive", "C"), "at-collection");
  assert.equal(mapDriverActionToShipmentStatus("complete", "C"), "collected");
  assert.equal(mapDriverActionToShipmentStatus("arrive", "D"), "out-for-delivery");
  // terminal transitions
  assert.equal(mapDriverActionToShipmentStatus("complete", "D"), "delivered");
  assert.equal(mapDriverActionToShipmentStatus("fail", "D"), "failed");
  assert.equal(mapDriverActionToShipmentStatus("skip", "C"), "skipped");
  assert.equal(isShipmentTerminal(mapDriverActionToShipmentStatus("complete", "D")), true);
  assert.equal(isShipmentTerminal(mapDriverActionToShipmentStatus("fail", "D")), true);
});

// --- server-path: webhook canonicalize-then-rank (suppression fix) ----------
test("webhook adopts higher-ranked canonical status, ignores out-of-order", () => {
  // Mirrors server/routes/webhooks.ts handleTrackingEvent: external free text
  // is canonicalised BEFORE ranking/storage (fall back to raw when no signal).
  const derive = (raw: string) => mapShipLogicToShipmentStatus(raw) ?? raw;
  // free-text "Out For Delivery" must advance a "booked" shipment (previously
  // it ranked 0 and was silently dropped).
  const incoming = derive("Out For Delivery");
  assert.equal(incoming, "out-for-delivery");
  assert.ok(rankShipmentStatus(incoming) > rankShipmentStatus("booked"));
  // a late "Booked" event must NOT regress an already-delivered shipment.
  const late = derive("Booked");
  assert.equal(rankShipmentStatus(late) >= rankShipmentStatus("delivered"), false);
  // what gets persisted is canonical, not the raw free text.
  assert.equal(derive("in_transit"), "out-for-delivery");
});

// --- end-to-end recognition simulation --------------------------------------
test("driver completion propagates to dispatch + drops shipment from route", () => {
  // 1. driver completes a delivery stop -> stored per-stop status (lowercase)
  const storedStopStatus = "completed"; // statusValue written to projects.stopStatuses
  // 2. dispatcher/route-planner reads it through the normalising boundary
  assert.equal(toDispatchStopStatus(storedStopStatus), "DONE");
  // 3. driver action also advances the shipment lifecycle to terminal
  const shipmentStatus = mapDriverActionToShipmentStatus("complete", "D");
  assert.equal(shipmentStatus, "delivered");
  // 4. route planner therefore drops it from active work
  assert.equal(isShipmentTerminal(shipmentStatus), true);
});

// --- already-collected (delivery-only routing) ------------------------------
test("already-collected shipments are recognised so they route delivery-only", () => {
  // ShipLogic free-text states that mean "on the vehicle, only delivery left".
  for (const s of ["Out for delivery", "out-for-delivery", "In Transit", "in_transit", "Collected", "On Vehicle", "with driver"]) {
    assert.equal(isShipmentCollected(s), true, `${s} should be collected`);
  }
  // Not-yet-collected states still need a collection leg.
  for (const s of ["Collection Assigned", "Booked", "Submitted", "At Collection", ""]) {
    assert.equal(isShipmentCollected(s), false, `${s} should NOT be collected`);
  }
  // Terminal states are never "collected" (they're done, not in-flight).
  for (const s of ["Delivered", "Failed", "Cancelled", "Returned", "Skipped"]) {
    assert.equal(isShipmentCollected(s), false, `${s} is terminal, not collected`);
    assert.equal(isShipmentTerminal(s), true);
  }
});

console.log(`\n${passed} tests passed`);
