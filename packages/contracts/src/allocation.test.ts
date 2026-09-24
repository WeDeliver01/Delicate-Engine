import { describe, expect, it } from "vitest";
import { allocate, recommendShares, urgencyBps, type AllocationWalletInput } from "./allocation.js";
import type { TreasuryPolicy } from "./dto/treasury.js";

const policy: TreasuryPolicy = {
  urgencyWindowDays: 10,
  urgencyMaxMultiplierBps: 25_000,
  reserveGateBps: 10_000,
};

const w = (
  over: Partial<AllocationWalletInput> & { id: string; slug: string },
): AllocationWalletInput => ({
  name: over.slug,
  category: "operating_expense",
  priority: 10,
  isRetainedEarnings: false,
  targetCents: 0,
  fundedCents: 0,
  dueDay: null,
  ...over,
});

const RENT = w({ id: "1", slug: "rent", targetCents: 1_500_000, dueDay: 1, priority: 1 });
const INSURANCE = w({ id: "2", slug: "insurance", targetCents: 500_000, dueDay: 20, priority: 2 });
const TAX = w({ id: "3", slug: "tax", category: "reserve", targetCents: 300_000, priority: 1 });
const EMERGENCY = w({
  id: "4",
  slug: "emergency",
  category: "reserve",
  targetCents: 200_000,
  priority: 2,
});
const RETAINED = w({
  id: "5",
  slug: "retained",
  category: "capital",
  isRetainedEarnings: true,
  priority: 99,
});

const sum = (lines: { amountCents: number }[]) => lines.reduce((s, l) => s + l.amountCents, 0);

describe("allocate", () => {
  it("funds the imminent debit order before distant ones, summing to the margin exactly", () => {
    // day 15: insurance is debited on the 20th (inside the 10-day window), rent on the 1st (16 days out)
    const lines = allocate({
      marginCents: 100_000,
      wallets: [RENT, INSURANCE, TAX, RETAINED],
      policy,
      dayOfMonth: 15,
      daysInMonth: 30,
    });
    expect(sum(lines)).toBe(100_000);
    expect(lines.every((l) => l.kind === "allocation")).toBe(true);
    const byWallet = Object.fromEntries(lines.map((l) => [l.walletSlug, l.amountCents]));
    expect(byWallet["insurance"]).toBe(100_000); // the urgent bill takes the scarce margin
    expect(byWallet["rent"]).toBeUndefined();
    expect(byWallet["tax"]).toBeUndefined(); // reserves are gated until obligations are covered
  });

  it("shares within a tier in proportion to need x urgency when both are urgent", () => {
    const a = w({ id: "a", slug: "a", targetCents: 100_000, dueDay: 18 });
    const b = w({ id: "b", slug: "b", targetCents: 300_000, dueDay: 18 });
    const lines = allocate({
      marginCents: 40_000,
      wallets: [a, b, RETAINED],
      policy,
      dayOfMonth: 15,
      daysInMonth: 30,
    });
    const by = Object.fromEntries(lines.map((l) => [l.walletSlug, l.amountCents]));
    expect(by["a"]).toBe(10_000);
    expect(by["b"]).toBe(30_000);
    expect(sum(lines)).toBe(40_000);
  });

  it("weights the sooner debit order above the later one for equal needs", () => {
    // both inside the 10-day window, so they share the tier — tomorrow's bill outweighs next week's
    const soon = w({ id: "a", slug: "soon", targetCents: 100_000, dueDay: 16 });
    const later = w({ id: "b", slug: "later", targetCents: 100_000, dueDay: 22 });
    const lines = allocate({
      marginCents: 100_000,
      wallets: [soon, later, RETAINED],
      policy,
      dayOfMonth: 15,
      daysInMonth: 30,
    });
    const by = Object.fromEntries(lines.map((l) => [l.walletSlug, l.amountCents]));
    expect(by["soon"]).toBeGreaterThan(by["later"]!);
    expect(sum(lines)).toBe(100_000);
  });

  it("starves a distant obligation entirely when an imminent one can absorb the margin", () => {
    const soon = w({ id: "a", slug: "soon", targetCents: 100_000, dueDay: 16 });
    const later = w({ id: "b", slug: "later", targetCents: 100_000, dueDay: 28 });
    const lines = allocate({
      marginCents: 100_000,
      wallets: [soon, later, RETAINED],
      policy,
      dayOfMonth: 15,
      daysInMonth: 30,
    });
    const by = Object.fromEntries(lines.map((l) => [l.walletSlug, l.amountCents]));
    expect(by["soon"]).toBe(100_000);
    expect(by["later"]).toBeUndefined();
    expect(sum(lines)).toBe(100_000);
  });

  it("caps each obligation at its remaining need and water-fills the rest", () => {
    const nearlyFunded = w({
      id: "a",
      slug: "nearly",
      targetCents: 100_000,
      fundedCents: 95_000,
      dueDay: 5,
    });
    const hungry = w({ id: "b", slug: "hungry", targetCents: 400_000, dueDay: 25 });
    const lines = allocate({
      marginCents: 200_000,
      wallets: [nearlyFunded, hungry, RETAINED],
      policy,
      dayOfMonth: 1,
      daysInMonth: 30,
    });
    const by = Object.fromEntries(lines.map((l) => [l.walletSlug, l.amountCents]));
    expect(by["nearly"]).toBe(5_000); // never more than the remaining need
    expect(by["hungry"]).toBe(195_000);
    expect(sum(lines)).toBe(200_000);
  });

  it("cascades to reserves in priority order once obligations are covered, then to retained earnings", () => {
    const funded = [
      { ...RENT, fundedCents: RENT.targetCents },
      { ...INSURANCE, fundedCents: INSURANCE.targetCents },
    ];
    const lines = allocate({
      marginCents: 700_000,
      wallets: [...funded, TAX, EMERGENCY, RETAINED],
      policy,
      dayOfMonth: 10,
      daysInMonth: 30,
    });
    const by = Object.fromEntries(lines.map((l) => [l.walletSlug, l.amountCents]));
    expect(by["tax"]).toBe(300_000); // priority 1, capped at target
    expect(by["emergency"]).toBe(200_000); // priority 2
    expect(by["retained"]).toBe(200_000); // the sink takes the rest
    expect(sum(lines)).toBe(700_000);
    expect(lines.filter((l) => l.kind === "overflow")).toHaveLength(3);
  });

  it("never loses a cent: the sink absorbs everything when nothing else can take it", () => {
    for (const margin of [1, 7, 999, 123_457]) {
      const lines = allocate({
        marginCents: margin,
        wallets: [{ ...RENT, fundedCents: RENT.targetCents }, RETAINED],
        policy,
        dayOfMonth: 3,
        daysInMonth: 31,
      });
      expect(sum(lines)).toBe(margin);
    }
  });

  it("allocates nothing when the margin is zero or negative", () => {
    expect(
      allocate({
        marginCents: 0,
        wallets: [RENT, RETAINED],
        policy,
        dayOfMonth: 1,
        daysInMonth: 30,
      }),
    ).toEqual([]);
    expect(
      allocate({
        marginCents: -500,
        wallets: [RENT, RETAINED],
        policy,
        dayOfMonth: 1,
        daysInMonth: 30,
      }),
    ).toEqual([]);
  });

  it("is deterministic", () => {
    const input = {
      marginCents: 250_000,
      wallets: [RENT, INSURANCE, TAX, RETAINED],
      policy,
      dayOfMonth: 12,
      daysInMonth: 31,
    };
    expect(allocate(input)).toEqual(allocate(input));
  });
});

describe("urgencyBps", () => {
  it("is 1.0 outside the window and peaks on the due day", () => {
    expect(urgencyBps(25, 1, 30, policy)).toBe(10_000);
    expect(urgencyBps(15, 15, 30, policy)).toBe(25_000);
    expect(urgencyBps(20, 15, 30, policy)).toBeGreaterThan(10_000);
    expect(urgencyBps(20, 15, 30, policy)).toBeLessThan(25_000);
  });

  it("wraps to next month when the due day has passed", () => {
    expect(urgencyBps(2, 28, 30, policy)).toBeGreaterThan(10_000); // 4 days away, not 26 days ago
  });
});

describe("recommendShares", () => {
  it("splits the whole margin across obligations when margin is scarce", () => {
    const rows = recommendShares([RENT, INSURANCE, TAX, RETAINED], 1_000_000);
    expect(rows.reduce((s, r) => s + r.bps, 0)).toBe(10_000);
    expect(rows.map((r) => r.slug).sort()).toEqual(["insurance", "rent"]);
  });

  it("earmarks reserves once margin exceeds obligations", () => {
    const rows = recommendShares([RENT, INSURANCE, TAX, EMERGENCY, RETAINED], 4_000_000);
    expect(rows.reduce((s, r) => s + r.bps, 0)).toBe(10_000);
    expect(rows.map((r) => r.slug)).toContain("tax");
    expect(rows.map((r) => r.slug)).toContain("retained");
  });
});
