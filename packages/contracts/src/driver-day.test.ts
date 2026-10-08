import { describe, expect, it } from "vitest";
import type { DriverStop, ShipmentStatus } from "./index.js";
import { dayProgress, stopIsDone } from "./driver-day.js";

const address = {
  formatted: "12 Oak St, Centurion",
  line1: null,
  suburb: "Centurion",
  city: "Pretoria",
  postalCode: null,
  country: "ZA",
  location: { lat: -25.86, lng: 28.19 },
  placeId: null,
};

const drop = (status: ShipmentStatus): DriverStop => ({
  kind: "drop",
  bookingId: "b1",
  bookingReference: "DC-1",
  shipmentId: "s1",
  waybill: "WB-1",
  status,
  done: false,
  address,
  contact: null,
  instructions: null,
  parcels: [],
  slotDate: "2026-10-08",
  slotWindowKey: "am",
  serviceLevelCode: "on_demand",
  shipments: [{ shipmentId: "s1", waybill: "WB-1", status }],
  changed: null,
});

const collection = (...statuses: ShipmentStatus[]): DriverStop => ({
  ...drop("assigned"),
  kind: "collection",
  shipmentId: null,
  waybill: null,
  status: null,
  shipments: statuses.map((status, i) => ({
    shipmentId: `s${i}`,
    waybill: `WB-${i}`,
    status,
  })),
});

describe("stopIsDone", () => {
  it("counts a delivered drop as done and one still being carried as not", () => {
    expect(stopIsDone(drop("delivered"))).toBe(true);
    expect(stopIsDone(drop("in_transit"))).toBe(false);
    expect(stopIsDone(drop("collected"))).toBe(false);
    expect(stopIsDone(drop("assigned"))).toBe(false);
  });

  it("counts a failed drop as done, because the driver cannot act on it again", () => {
    // Dispatch reassigns a failed drop. Leaving it outstanding would mean a driver who tried
    // every address they were given is never told they have finished.
    expect(stopIsDone(drop("failed"))).toBe(true);
  });

  it("judges a collection from its shipments, not its own status", () => {
    // A collection stop's status is always null — it covers the whole booking.
    expect(stopIsDone(collection("assigned", "assigned"))).toBe(false);
    expect(stopIsDone(collection("collected", "collected"))).toBe(true);
    expect(stopIsDone(collection("delivered", "collected"))).toBe(true);
  });

  it("keeps a part-loaded collection outstanding", () => {
    // One parcel still on the counter is a reason to go back, so the stop is not done.
    expect(stopIsDone(collection("collected", "assigned"))).toBe(false);
  });
});

describe("dayProgress", () => {
  it("tallies collections and deliveries separately and together", () => {
    const p = dayProgress([
      collection("collected"),
      drop("delivered"),
      drop("in_transit"),
      drop("assigned"),
    ]);
    expect(p.collections).toEqual({ total: 1, done: 1, outstanding: 0 });
    expect(p.deliveries).toEqual({ total: 3, done: 1, outstanding: 2 });
    expect(p.all).toEqual({ total: 4, done: 2, outstanding: 2 });
    expect(p.allDone).toBe(false);
  });

  it("reports a finished day", () => {
    const p = dayProgress([collection("delivered"), drop("delivered"), drop("failed")]);
    expect(p.allDone).toBe(true);
    expect(p.all.outstanding).toBe(0);
  });

  it("does not call an empty day a finished one", () => {
    // The distinction the old screen could not make: nothing assigned yet is not all done.
    // Getting this wrong tells a driver who has been given no work that they may go home.
    const p = dayProgress([]);
    expect(p.allDone).toBe(false);
    expect(p.all).toEqual({ total: 0, done: 0, outstanding: 0 });
  });
});
