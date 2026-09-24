import type { AllocationKind, TreasuryPolicy, WalletCategory } from "./dto/treasury.js";

/**
 * The allocation algorithm. Pure: same inputs, same split, every time — which is what makes
 * every allocation reproducible and auditable.
 *
 * Phase 1 — obligations, urgent first. An operating wallet whose debit order lands inside the
 * urgency window is funded to its full remaining need before any margin reaches obligations
 * further out: that ordering is what stops a payment bouncing. Within a tier, margin is shared
 * in proportion to `remaining need × urgency` (urgency climbing from 1.0 to `urgencyMax` as the
 * due date approaches), capped at each wallet's need, with a bounded water-fill loop
 * redistributing whatever the caps left over.
 *
 * Phase 2 — cascade. Anything still left flows to reserves in priority order (each capped at its
 * monthly target), then the remainder lands in retained earnings.
 *
 * Because retained earnings is an unbounded sink, the lines always sum to the margin exactly.
 */

export interface AllocationWalletInput {
  id: string;
  slug: string;
  name: string;
  category: WalletCategory;
  priority: number;
  isRetainedEarnings: boolean;
  /** This month's bill (operating) or target balance (reserve/capital). 0 = unbounded. */
  targetCents: number;
  /** Already funded in this period. */
  fundedCents: number;
  /** Day of month the debit order lands; null for reserves. */
  dueDay: number | null;
}

export interface AllocationInput {
  marginCents: number;
  wallets: AllocationWalletInput[];
  policy: TreasuryPolicy;
  /** Day of the month the allocation happens (1–31) and days in that month. */
  dayOfMonth: number;
  daysInMonth: number;
}

export interface AllocationLine {
  walletId: string;
  walletSlug: string;
  name: string;
  amountCents: number;
  kind: AllocationKind;
}

/** Urgency multiplier in basis points: 10000 outside the window, rising to the policy max on the due day. */
export function urgencyBps(
  dueDay: number,
  dayOfMonth: number,
  daysInMonth: number,
  policy: TreasuryPolicy,
): number {
  // Days until the debit order, wrapping into next month if it has already passed this month.
  const days = dueDay >= dayOfMonth ? dueDay - dayOfMonth : daysInMonth - dayOfMonth + dueDay;
  if (days >= policy.urgencyWindowDays) return 10_000;
  const closeness = (policy.urgencyWindowDays - days) / policy.urgencyWindowDays; // 0 → 1
  return Math.round(10_000 + (policy.urgencyMaxMultiplierBps - 10_000) * closeness);
}

export function allocate(input: AllocationInput): AllocationLine[] {
  const lines: AllocationLine[] = [];
  let remaining = Math.max(0, Math.round(input.marginCents));
  if (remaining === 0) return lines;

  const push = (w: AllocationWalletInput, amountCents: number, kind: AllocationKind) => {
    if (amountCents <= 0) return;
    const existing = lines.find((l) => l.walletId === w.id && l.kind === kind);
    if (existing) existing.amountCents += amountCents;
    else lines.push({ walletId: w.id, walletSlug: w.slug, name: w.name, amountCents, kind });
    remaining -= amountCents;
  };

  // ── Phase 1: obligations ──────────────────────────────────────────────────────
  // Urgent first: a debit order landing inside the urgency window is funded to its full need
  // before margin spills to obligations further out — that is what stops a bounced payment.
  // Inside each tier, margin is shared in proportion to need × urgency and water-filled.
  const operating = input.wallets
    .filter((w) => w.category === "operating_expense" && w.targetCents > w.fundedCents)
    .map((w) => ({
      wallet: w,
      need: w.targetCents - w.fundedCents,
      taken: 0,
      urgency: w.dueDay
        ? urgencyBps(w.dueDay, input.dayOfMonth, input.daysInMonth, input.policy)
        : 10_000,
    }));

  const tiers = [
    operating.filter((o) => o.urgency > 10_000),
    operating.filter((o) => o.urgency === 10_000),
  ];
  for (const tier of tiers) {
    if (remaining <= 0) break;
    remaining -= waterFill(tier, remaining);
  }
  for (const o of operating) {
    if (o.taken > 0) {
      lines.push({
        walletId: o.wallet.id,
        walletSlug: o.wallet.slug,
        name: o.wallet.name,
        amountCents: o.taken,
        kind: "allocation",
      });
    }
  }

  // ── Phase 2: cascade to reserves, then the sink ───────────────────────────────
  if (remaining > 0) {
    const coverageBps = coverage(input.wallets, operating);
    if (coverageBps >= input.policy.reserveGateBps) {
      const reserves = input.wallets
        .filter(
          (w) =>
            (w.category === "reserve" || w.category === "capital") &&
            !w.isRetainedEarnings &&
            w.targetCents > w.fundedCents,
        )
        .sort((a, b) => a.priority - b.priority);
      for (const w of reserves) {
        if (remaining <= 0) break;
        push(w, Math.min(w.targetCents - w.fundedCents, remaining), "overflow");
      }
    }
  }
  if (remaining > 0) {
    const sink = input.wallets.find((w) => w.isRetainedEarnings);
    if (sink) push(sink, remaining, "overflow");
    else {
      // No sink configured: the last operating wallet absorbs it so nothing is lost.
      const last = input.wallets.filter((w) => w.category === "operating_expense").at(-1);
      if (last) push(last, remaining, "overflow");
    }
  }

  return lines;
}

/**
 * Share `budget` across claims in proportion to `need x urgency`, capped at each claim's
 * remaining need, looping until the budget is spent or every need is met. Returns what it spent.
 */
function waterFill(
  claims: { need: number; taken: number; urgency: number }[],
  budget: number,
): number {
  let spent = 0;
  for (let pass = 0; pass < 8 && spent < budget; pass++) {
    const open = claims.filter((c) => c.taken < c.need);
    if (open.length === 0) break;
    const left = budget - spent;
    const weights = open.map((c) => ({ c, weight: (c.need - c.taken) * c.urgency }));
    const totalWeight = weights.reduce((s, w) => s + w.weight, 0);
    if (totalWeight <= 0) break;

    let passSpent = 0;
    for (const { c, weight } of weights) {
      const share = Math.min(
        Math.floor((left * weight) / totalWeight),
        c.need - c.taken,
        left - passSpent,
      );
      if (share <= 0) continue;
      c.taken += share;
      passSpent += share;
    }
    // Rounding can strand a few cents while capacity remains: give them to the neediest claim.
    if (passSpent < left) {
      const next = weights
        .filter(({ c }) => c.taken < c.need)
        .sort((a, b) => b.weight - a.weight)[0];
      if (next) {
        const extra = Math.min(left - passSpent, next.c.need - next.c.taken);
        next.c.taken += extra;
        passSpent += extra;
      }
    }
    if (passSpent === 0) break;
    spent += passSpent;
  }
  return spent;
}

/** Obligation coverage in basis points after this allocation's phase 1. */
function coverage(
  wallets: AllocationWalletInput[],
  operating: { wallet: AllocationWalletInput; taken: number }[],
): number {
  const total = wallets
    .filter((w) => w.category === "operating_expense")
    .reduce((s, w) => s + w.targetCents, 0);
  if (total <= 0) return 10_000;
  const funded =
    wallets
      .filter((w) => w.category === "operating_expense")
      .reduce((s, w) => s + Math.min(w.fundedCents, w.targetCents), 0) +
    operating.reduce((s, o) => s + o.taken, 0);
  return Math.min(10_000, Math.round((funded / total) * 10_000));
}

/**
 * Recommended share of margin per wallet, in basis points — the plan the dashboard shows.
 * When margin is scarce (the usual case early on) the whole margin is split across obligations
 * by size; when it is ample, each obligation takes what it needs and the rest goes to reserves.
 */
export function recommendShares(
  wallets: AllocationWalletInput[],
  monthlyMarginCents: number,
): { walletId: string; slug: string; bps: number }[] {
  const operating = wallets.filter((w) => w.category === "operating_expense" && w.targetCents > 0);
  const obligations = operating.reduce((s, w) => s + w.targetCents, 0);
  if (obligations === 0 || monthlyMarginCents <= 0) return [];

  if (monthlyMarginCents <= obligations) {
    const out = operating.map((w) => ({
      walletId: w.id,
      slug: w.slug,
      bps: Math.round((w.targetCents / obligations) * 10_000),
    }));
    return balanceTo10k(out);
  }
  const out = operating.map((w) => ({
    walletId: w.id,
    slug: w.slug,
    bps: Math.round((w.targetCents / monthlyMarginCents) * 10_000),
  }));
  const used = out.reduce((s, o) => s + o.bps, 0);
  const reserves = wallets
    .filter((w) => (w.category === "reserve" || w.category === "capital") && !w.isRetainedEarnings)
    .sort((a, b) => a.priority - b.priority);
  let left = 10_000 - used;
  for (const w of reserves) {
    if (left <= 0) break;
    const want = w.targetCents > 0 ? Math.round((w.targetCents / monthlyMarginCents) * 10_000) : 0;
    const bps = Math.min(want, left);
    if (bps > 0) {
      out.push({ walletId: w.id, slug: w.slug, bps });
      left -= bps;
    }
  }
  const sink = wallets.find((w) => w.isRetainedEarnings);
  if (left > 0 && sink) out.push({ walletId: sink.id, slug: sink.slug, bps: left });
  return balanceTo10k(out);
}

function balanceTo10k(rows: { walletId: string; slug: string; bps: number }[]) {
  const total = rows.reduce((s, r) => s + r.bps, 0);
  if (total === 10_000 || rows.length === 0) return rows;
  const biggest = rows.reduce((a, b) => (a.bps >= b.bps ? a : b));
  biggest.bps += 10_000 - total;
  return rows;
}
