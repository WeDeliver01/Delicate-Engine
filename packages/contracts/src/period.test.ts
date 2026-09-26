import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  formatRange,
  monthOf,
  previousPeriod,
  rangeToInstants,
  resolvePeriod,
  toOperatingDate,
} from "./period.js";

/** 2026-09-26 at 09:00 UTC, which is 11:00 in Johannesburg. */
const NOON = new Date("2026-09-26T09:00:00Z");

describe("operating timezone", () => {
  it("reads the calendar date in Johannesburg, not UTC", () => {
    // 22:30 UTC is already half past midnight the next day in SAST. A shipment booked then
    // belongs to the 27th on the operations board, not the 26th.
    expect(toOperatingDate(new Date("2026-09-26T22:30:00Z"))).toBe("2026-09-27");
    expect(toOperatingDate(new Date("2026-09-26T21:59:00Z"))).toBe("2026-09-26");
  });

  it("puts the first two hours of a UTC day on the previous operating day", () => {
    expect(toOperatingDate(new Date("2026-09-26T00:30:00Z"))).toBe("2026-09-26");
  });
});

describe("resolvePeriod", () => {
  it("resolves the single-day periods", () => {
    expect(resolvePeriod("today", { now: NOON })).toEqual({ from: "2026-09-26", to: "2026-09-26" });
    expect(resolvePeriod("yesterday", { now: NOON })).toEqual({
      from: "2026-09-25",
      to: "2026-09-25",
    });
    expect(resolvePeriod("tomorrow", { now: NOON })).toEqual({
      from: "2026-09-27",
      to: "2026-09-27",
    });
  });

  it("includes today in a trailing window", () => {
    // Seven days means today and the six before it: a window ending yesterday would hide
    // everything that happened this morning, which is the part being looked at.
    expect(resolvePeriod("last7", { now: NOON })).toEqual({ from: "2026-09-20", to: "2026-09-26" });
    expect(resolvePeriod("last28", { now: NOON })).toEqual({
      from: "2026-08-30",
      to: "2026-09-26",
    });
    expect(resolvePeriod("next7", { now: NOON })).toEqual({ from: "2026-09-26", to: "2026-10-02" });
  });

  it("resolves calendar months, including the 30-day ones", () => {
    expect(resolvePeriod("this_month", { now: NOON })).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(resolvePeriod("last_month", { now: NOON })).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("crosses the year boundary backwards", () => {
    const jan = new Date("2026-01-14T09:00:00Z");
    expect(resolvePeriod("last_month", { now: jan })).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("gets February right in a leap year", () => {
    expect(monthOf("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthOf("2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("falls back to today when a custom range is half-filled", () => {
    // A date picker with one box filled is a normal state for a form to be in mid-edit, so it
    // shows today rather than an error or an empty page.
    expect(resolvePeriod("custom", { now: NOON, from: "2026-09-01" })).toEqual({
      from: "2026-09-26",
      to: "2026-09-26",
    });
  });

  it("accepts a custom range entered backwards", () => {
    expect(resolvePeriod("custom", { now: NOON, from: "2026-09-30", to: "2026-09-01" })).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });
});

describe("range arithmetic", () => {
  it("shifts across month and year ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("counts days between dates inclusively of neither end", () => {
    expect(daysBetween("2026-09-20", "2026-09-26")).toBe(6);
    expect(daysBetween("2026-09-26", "2026-09-20")).toBe(-6);
  });

  it("compares against a window of the same length", () => {
    // "Up 12%" is meaningless unless both windows are the same size.
    expect(previousPeriod({ from: "2026-09-20", to: "2026-09-26" })).toEqual({
      from: "2026-09-13",
      to: "2026-09-19",
    });
    expect(previousPeriod({ from: "2026-09-26", to: "2026-09-26" })).toEqual({
      from: "2026-09-25",
      to: "2026-09-25",
    });
  });

  it("converts a calendar range to the UTC instants it covers", () => {
    // A Johannesburg day starts at 22:00 UTC the day before and the window is half-open, so
    // nothing falls through the gap at midnight.
    const { from, toExclusive } = rangeToInstants({ from: "2026-09-26", to: "2026-09-26" });
    expect(from.toISOString()).toBe("2026-09-25T22:00:00.000Z");
    expect(toExclusive.toISOString()).toBe("2026-09-26T22:00:00.000Z");
  });
});

describe("formatRange", () => {
  it("names a single day in full", () => {
    expect(formatRange({ from: "2026-09-26", to: "2026-09-26" })).toBe("26 Sep 2026");
  });

  it("states the year once when a range stays inside it", () => {
    expect(formatRange({ from: "2026-09-01", to: "2026-09-26" })).toBe("1 Sep – 26 Sep 2026");
  });

  it("states both years when a range crosses one", () => {
    expect(formatRange({ from: "2025-12-20", to: "2026-01-05" })).toBe("20 Dec 2025 – 5 Jan 2026");
  });
});
