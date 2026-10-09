import { Injectable } from "@nestjs/common";
import { and, asc, between, eq, sql } from "drizzle-orm";
import type {
  BlackoutDate,
  SetSlotRequest,
  SlotAvailability,
  SlotPolicy,
  SlotRef,
  TimedWindow,
  TimedWindowPolicy,
  WindowBandAvailability,
} from "@delicate/contracts";
import { blackoutDates, deliverySlots, windowBands, type DbExecutor } from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { SettingsService } from "../../infra/settings.service.js";
import { AppError } from "../../common/errors.js";
import { Clock } from "../../infra/clock.js";

export interface LocalNow {
  date: string; // YYYY-MM-DD
  minutes: number; // minutes since local midnight
}

/**
 * Slots are derived from the policy and materialised on first touch. `reserve` is the only
 * path that consumes capacity and it runs under a row lock inside the booking transaction, so
 * two customers racing for the last space cannot both win (invariant #4).
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly dbs: DbService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async policy(): Promise<SlotPolicy> {
    return this.settings.get("scheduling.policy");
  }

  async localNow(): Promise<LocalNow> {
    const tz = await this.settings.get("company.timezone");
    return toLocal(this.clock.now(), tz);
  }

  /**
   * What is on offer, day by day and window by window.
   *
   * `immediate` is for a service that dispatches on the spot. The lead time everything else
   * is scheduled around does not apply to it -- being bookable today is what it is for -- so
   * the only day it offers is today, and a window stays open until it has passed rather than
   * closing two hours before it starts. Everything else still holds: a blackout, a day we do
   * not work, a window somebody closed by hand and a window that is full are all still shut.
   */
  async availability(
    dateFrom?: string,
    dateTo?: string,
    opts: { immediate?: boolean } = {},
  ): Promise<SlotAvailability[]> {
    const [policy, now] = await Promise.all([this.policy(), this.localNow()]);
    if (opts.immediate) {
      dateFrom = now.date;
      dateTo = now.date;
    }
    const from = dateFrom ?? now.date;
    const to = dateTo ?? addDays(now.date, policy.horizonDays);
    if (to < from)
      throw AppError.validation([{ path: ["dateTo"], message: "must be on or after dateFrom" }]);
    // Wide enough for the booking horizon — customers book months out for weddings — and
    // still a bound, because this materialises a row per window per day.
    if (daysBetween(from, to) > 400)
      throw AppError.validation([{ path: ["dateTo"], message: "range too large" }]);

    const [rows, blackouts] = await Promise.all([
      this.dbs.db
        .select()
        .from(deliverySlots)
        .where(between(deliverySlots.date, from, to)),
      this.dbs.db
        .select()
        .from(blackoutDates)
        .where(between(blackoutDates.date, from, to)),
    ]);
    const byKey = new Map(rows.map((r) => [`${r.date}:${r.windowKey}`, r]));
    const blackout = new Set(blackouts.map((b) => b.date));

    const out: SlotAvailability[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!policy.operatingDays.includes(weekday(d))) continue;
      for (const w of policy.windows) {
        const row = byKey.get(`${d}:${w.key}`);
        const capacity = row?.capacity ?? w.capacity ?? policy.defaultCapacity;
        const booked = row?.bookedCount ?? 0;
        const remaining = Math.max(0, capacity - booked);
        const reason = closedReason({
          date: d,
          window: w,
          row,
          remaining,
          blackout: blackout.has(d),
          policy,
          now,
          immediate: opts.immediate === true,
        });
        out.push({
          date: d,
          windowKey: w.key,
          label: w.label,
          startMinutes: w.startMinutes,
          endMinutes: w.endMinutes,
          capacity,
          booked,
          remaining,
          bookable: reason === null,
          closedReason: reason,
        });
      }
    }
    return out;
  }

  /** Consume one space. Throws 409 `slot_unavailable` with the reason. */
  async reserve(tx: DbExecutor, ref: SlotRef, opts: { immediate?: boolean } = {}): Promise<void> {
    const [policy, now] = await Promise.all([this.policy(), this.localNow()]);
    const window = policy.windows.find((w) => w.key === ref.windowKey);
    if (!window) throw AppError.notFound("slot window", { windowKey: ref.windowKey });
    if (!policy.operatingDays.includes(weekday(ref.date))) {
      throw new AppError("slot_unavailable", "we do not deliver on that day", 409, {
        reason: "closed",
      });
    }
    const blackout = await tx.query.blackoutDates.findFirst({
      where: eq(blackoutDates.date, ref.date),
    });

    await tx
      .insert(deliverySlots)
      .values({
        date: ref.date,
        windowKey: ref.windowKey,
        capacity: window.capacity ?? policy.defaultCapacity,
      })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(deliverySlots)
      .where(and(eq(deliverySlots.date, ref.date), eq(deliverySlots.windowKey, ref.windowKey)))
      .for("update");
    if (!row) throw AppError.notFound("slot");

    const remaining = Math.max(0, row.capacity - row.bookedCount);
    const reason = closedReason({
      date: ref.date,
      window,
      row,
      remaining,
      blackout: !!blackout,
      policy,
      now,
      immediate: opts.immediate === true,
    });
    if (reason)
      throw new AppError("slot_unavailable", `slot is not bookable (${reason})`, 409, {
        reason,
        ...ref,
      });

    const booked = row.bookedCount + 1;
    await tx
      .update(deliverySlots)
      .set({ bookedCount: booked, status: booked >= row.capacity ? "closed_full" : row.status })
      .where(eq(deliverySlots.id, row.id));
  }

  /** Give a space back (cancellation). Reopens a slot that auto-closed. */
  async release(tx: DbExecutor, ref: SlotRef): Promise<void> {
    const [row] = await tx
      .select()
      .from(deliverySlots)
      .where(and(eq(deliverySlots.date, ref.date), eq(deliverySlots.windowKey, ref.windowKey)))
      .for("update");
    if (!row || row.bookedCount === 0) return;
    const booked = row.bookedCount - 1;
    await tx
      .update(deliverySlots)
      .set({
        bookedCount: booked,
        status: row.status === "closed_full" && booked < row.capacity ? "open" : row.status,
      })
      .where(eq(deliverySlots.id, row.id));
  }

  // ── admin ──────────────────────────────────────────────────────────────────

  // ── timed windows ───────────────────────────────────────────────────────────

  /**
   * Which hour bands a window covers.
   *
   * A window consumes every band it touches, which is conservative: a 10:00–12:00 promise might
   * be kept at either end, so both hours have to be able to absorb it. Over-promising a window
   * costs a customer; under-selling capacity is recoverable by putting another driver on. When
   * the two are not symmetrical, be careful in the direction that keeps promises.
   */
  bandsFor(window: TimedWindow, policy: TimedWindowPolicy): number[] {
    const width = policy.bandMinutes;
    const first = Math.floor(window.startMinute / width) * width;
    const out: number[] = [];
    // `endMinute` is exclusive as a boundary: a 09:00–10:00 window is the 09:00 band alone.
    for (let at = first; at < window.endMinute; at += width) out.push(at);
    return out;
  }

  /** Whether a window is one we are willing to sell at all. */
  checkWindow(window: TimedWindow, policy: TimedWindowPolicy): void {
    if (!policy.enabled) {
      throw AppError.conflict("timed_windows_off", "timed windows are not on sale");
    }
    const width = window.endMinute - window.startMinute;
    if (width <= 0) {
      throw AppError.validation([
        { path: ["endMinute"], message: "a window cannot end before it starts" },
      ]);
    }
    if (width < policy.minMinutes) {
      throw AppError.validation([
        {
          path: ["endMinute"],
          message: `the narrowest window we promise is ${policy.minMinutes} minutes`,
        },
      ]);
    }
    if (width > policy.maxMinutes) {
      throw AppError.validation([
        {
          path: ["endMinute"],
          message: `a window wider than ${policy.maxMinutes} minutes is the slot; do not ask for one`,
        },
      ]);
    }
  }

  /**
   * Hold a place in every band the given windows cover.
   *
   * Takes every window at once, on purpose. Locking a collection's bands and then a delivery's
   * would not be globally ascending, and that is all a deadlock needs: one booking holding the
   * 09:00 band and wanting 14:00 while another holds 14:00 and wants 09:00. Gathering the bands
   * first and taking them in one ascending pass means two bookings racing for the same hour
   * always queue, and the loser is refused cleanly rather than both hanging.
   *
   * Two windows that fall in the same band consume two places: they are two promises to be
   * somewhere, and the driver cannot keep both by being in one place.
   */
  async reserveWindows(tx: DbExecutor, date: string, windows: TimedWindow[]): Promise<void> {
    const live = windows.filter((w): w is TimedWindow => !!w);
    if (live.length === 0) return;
    const policy = (await this.policy()).timedWindow;
    for (const window of live) this.checkWindow(window, policy);

    const wanted = new Map<number, number>();
    for (const window of live) {
      for (const band of this.bandsFor(window, policy)) {
        wanted.set(band, (wanted.get(band) ?? 0) + 1);
      }
    }

    for (const startMinute of [...wanted.keys()].sort((a, b) => a - b)) {
      const take = wanted.get(startMinute)!;
      await tx
        .insert(windowBands)
        .values({ date, startMinute, capacity: policy.capacityPerBand })
        .onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(windowBands)
        .where(and(eq(windowBands.date, date), eq(windowBands.startMinute, startMinute)))
        .for("update");
      if (!row) throw AppError.notFound("capacity band");
      if (row.bookedCount + take > row.capacity) {
        throw new AppError(
          "window_unavailable",
          `we are full between ${clock(startMinute)} and ${clock(startMinute + policy.bandMinutes)}`,
          409,
          { date, startMinute, capacity: row.capacity, booked: row.bookedCount },
        );
      }
      await tx
        .update(windowBands)
        .set({ bookedCount: row.bookedCount + take })
        .where(eq(windowBands.id, row.id));
    }
  }

  /** Give those places back. Same ascending pass, for the same reason. */
  async releaseWindows(tx: DbExecutor, date: string, windows: TimedWindow[]): Promise<void> {
    const live = windows.filter((w): w is TimedWindow => !!w);
    if (live.length === 0) return;
    const policy = (await this.policy()).timedWindow;
    const wanted = new Map<number, number>();
    for (const window of live) {
      for (const band of this.bandsFor(window, policy)) {
        wanted.set(band, (wanted.get(band) ?? 0) + 1);
      }
    }
    for (const startMinute of [...wanted.keys()].sort((a, b) => a - b)) {
      const [row] = await tx
        .select()
        .from(windowBands)
        .where(and(eq(windowBands.date, date), eq(windowBands.startMinute, startMinute)))
        .for("update");
      if (!row || row.bookedCount === 0) continue;
      await tx
        .update(windowBands)
        .set({ bookedCount: Math.max(0, row.bookedCount - wanted.get(startMinute)!) })
        .where(eq(windowBands.id, row.id));
    }
  }

  /** What a customer can be offered on a date, band by band. */
  async windowAvailability(date: string): Promise<WindowBandAvailability[]> {
    const policy = await this.policy();
    const timed = policy.timedWindow;
    if (!timed.enabled) return [];
    const rows = await this.dbs.db.select().from(windowBands).where(eq(windowBands.date, date));
    const booked = new Map(rows.map((r) => [r.startMinute, r]));

    const first = policy.windows[0]?.startMinutes ?? 0;
    const last = policy.windows[policy.windows.length - 1]?.endMinutes ?? 1440;
    const out: WindowBandAvailability[] = [];
    for (let at = first; at + timed.bandMinutes <= last; at += timed.bandMinutes) {
      const row = booked.get(at);
      const capacity = row?.capacity ?? timed.capacityPerBand;
      const used = row?.bookedCount ?? 0;
      out.push({
        date,
        startMinute: at,
        endMinute: at + timed.bandMinutes,
        capacity,
        booked: used,
        remaining: Math.max(0, capacity - used),
        bookable: capacity - used > 0,
      });
    }
    return out;
  }

  async updatePolicy(policy: SlotPolicy): Promise<SlotPolicy> {
    for (const w of policy.windows) {
      if (w.endMinutes <= w.startMinutes)
        throw AppError.validation([
          { path: ["windows"], message: `${w.key}: end must be after start` },
        ]);
    }
    if (new Set(policy.windows.map((w) => w.key)).size !== policy.windows.length) {
      throw AppError.validation([{ path: ["windows"], message: "window keys must be unique" }]);
    }
    await this.settings.set("scheduling.policy", policy);
    return policy;
  }

  async setSlot(input: SetSlotRequest): Promise<SlotAvailability> {
    const policy = await this.policy();
    const window = policy.windows.find((w) => w.key === input.windowKey);
    if (!window) throw AppError.notFound("slot window");
    await this.dbs.transaction(async (tx) => {
      await tx
        .insert(deliverySlots)
        .values({
          date: input.date,
          windowKey: input.windowKey,
          capacity: window.capacity ?? policy.defaultCapacity,
        })
        .onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(deliverySlots)
        .where(
          and(eq(deliverySlots.date, input.date), eq(deliverySlots.windowKey, input.windowKey)),
        )
        .for("update");
      const capacity = input.capacity ?? row!.capacity;
      let status = row!.status;
      if (input.closed === true) status = "closed_manual";
      else if (input.closed === false)
        status = row!.bookedCount >= capacity ? "closed_full" : "open";
      else if (status !== "closed_manual")
        status = row!.bookedCount >= capacity ? "closed_full" : "open";
      await tx.update(deliverySlots).set({ capacity, status }).where(eq(deliverySlots.id, row!.id));
      await this.audit.record(tx, {
        action: "slot.set",
        entityType: "delivery_slot",
        entityId: row!.id,
        before: row,
        after: { capacity, status },
      });
    });
    const [slot] = await this.availability(input.date, input.date).then((a) =>
      a.filter((s) => s.windowKey === input.windowKey),
    );
    return slot!;
  }

  async listBlackouts(): Promise<BlackoutDate[]> {
    const rows = await this.dbs.db.select().from(blackoutDates).orderBy(asc(blackoutDates.date));
    return rows.map((r) => ({ date: r.date, reason: r.reason }));
  }

  async addBlackout(input: BlackoutDate): Promise<BlackoutDate> {
    await this.dbs.transaction(async (tx) => {
      await tx
        .insert(blackoutDates)
        .values(input)
        .onConflictDoUpdate({ target: blackoutDates.date, set: { reason: input.reason } });
      await this.audit.record(tx, {
        action: "blackout.add",
        entityType: "blackout_date",
        entityId: input.date,
        after: input,
      });
    });
    return input;
  }

  async removeBlackout(date: string): Promise<void> {
    await this.dbs.transaction(async (tx) => {
      await tx.delete(blackoutDates).where(eq(blackoutDates.date, date));
      await this.audit.record(tx, {
        action: "blackout.remove",
        entityType: "blackout_date",
        entityId: date,
      });
    });
  }

  async slotsBetween(from: string, to: string) {
    return this.dbs.db
      .select()
      .from(deliverySlots)
      .where(between(deliverySlots.date, from, to))
      .orderBy(asc(deliverySlots.date), asc(sql`${deliverySlots.windowKey}`));
  }
}

function closedReason(a: {
  date: string;
  window: { startMinutes: number; endMinutes: number };
  row: { status: string } | undefined;
  remaining: number;
  blackout: boolean;
  policy: SlotPolicy;
  now: LocalNow;
  /** A service that dispatches on the spot: see `availability`. */
  immediate?: boolean;
}): SlotAvailability["closedReason"] {
  if (a.blackout) return "blackout";
  if (a.row?.status === "closed_manual") return "closed";
  if (a.date < a.now.date) return "cutoff_passed";
  if (a.immediate) {
    // A driver leaves now, so what matters is whether the window is still running -- not
    // whether we were given notice, which by definition we were not.
    if (a.date > a.now.date) return "lead_time";
    if (a.now.minutes >= a.window.endMinutes) return "cutoff_passed";
    return a.remaining <= 0 ? "full" : null;
  }
  if (daysBetween(a.now.date, a.date) < a.policy.minLeadDays) return "lead_time";
  if (a.date === a.now.date && a.now.minutes > a.window.startMinutes - a.policy.cutoffMinutesBefore)
    return "cutoff_passed";
  if (a.remaining <= 0) return "full";
  return null;
}

// ── date helpers (all on YYYY-MM-DD strings, no timezone surprises) ───────────

export function toLocal(instant: Date, timeZone: string): LocalNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d + days);
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Minutes past midnight as a clock a customer can read. */
function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
