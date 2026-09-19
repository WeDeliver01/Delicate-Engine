import { describe, expect, it } from "vitest";
import { applyBps, Cents, formatCents, randsToCents } from "./money.js";

describe("money", () => {
  it("rejects non-integer cents", () => {
    expect(Cents.safeParse(10.5).success).toBe(false);
    expect(Cents.safeParse(1050).success).toBe(true);
  });

  it("converts rands to cents without float drift", () => {
    expect(randsToCents(241.52)).toBe(24152);
    expect(randsToCents(0.1 + 0.2)).toBe(30);
  });

  it("applies basis points with half-up rounding", () => {
    expect(applyBps(10_000, 1_400)).toBe(1_400); // 14%
    expect(applyBps(24_152, 3_200)).toBe(7_729); // 32% of R241.52 = R77.2864 -> R77.29
  });

  it("formats as ZAR", () => {
    expect(formatCents(24152).replace(/ /g, " ")).toMatch(/R\s?241[,.]52/);
  });
});
