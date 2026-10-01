/**
 * Reporting periods.
 *
 * Every dashboard, filter and report narrows to a stretch of time, and all of them have to
 * agree on where a day starts. That is not obvious: the engine runs in UTC, the business runs
 * in Johannesburg, and at 01:00 SAST those disagree about what "today" means. Getting it wrong
 * puts a morning delivery in yesterday's numbers.
 *
 * So periods are resolved to calendar dates in the operating timezone and expressed as an
 * inclusive `from`/`to` pair of YYYY-MM-DD strings, which is exactly what `slot_date` holds.
 * Nothing here touches the machine's local timezone.
 */

/**
 * South Africa has no daylight saving and has kept UTC+2 since 1903, so a fixed offset is
 * honest here in a way it would not be for most of the world. Stated as a constant rather than
 * scattered as `+2` so the day this stops being true there is one place to change.
 */
export const OPERATING_UTC_OFFSET_HOURS = 2;

/**
 * The IANA zone the business runs in, for formatting a time a person will read.
 *
 * The offset above is enough for calendar arithmetic; this is for `Intl`, which needs the
 * zone name. Both are needed because the engine's containers run in UTC with no TZ set, so
 * anything the *server* formats renders two hours early unless it says otherwise — and a
 * delivery confirmation claiming a parcel arrived at 17:50 when it arrived at 19:50 is the
 * kind of wrong that a customer notices and we cannot explain.
 */
export const OPERATING_TIMEZONE = "Africa/Johannesburg";

/** A date and time as someone in Johannesburg would read it, e.g. "01/10/2026, 19:48". */
export function formatOperatingDateTime(at: Date | string): string {
  return new Date(at).toLocaleString("en-ZA", {
    timeZone: OPERATING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A date alone, e.g. "01/10/2026". Crosses midnight correctly: 22:30 UTC is already tomorrow. */
export function formatOperatingDate(at: Date | string): string {
  return new Date(at).toLocaleDateString("en-ZA", {
    timeZone: OPERATING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export const PERIOD_KEYS = [
  "today",
  "yesterday",
  "tomorrow",
  "last7",
  "next7",
  "last28",
  "this_month",
  "last_month",
  "custom",
] as const;

export type PeriodKey = (typeof PERIOD_KEYS)[number];

export interface DateRange {
  /** Inclusive, YYYY-MM-DD in the operating timezone. */
  from: string;
  /** Inclusive, YYYY-MM-DD in the operating timezone. */
  to: string;
}

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  tomorrow: "Tomorrow",
  last7: "Last 7 days",
  next7: "Next 7 days",
  last28: "Last 28 days",
  this_month: "This month",
  last_month: "Last month",
  custom: "Custom",
};

/** The calendar date it is right now in the operating timezone, as YYYY-MM-DD. */
export function operatingToday(now: Date = new Date()): string {
  return toOperatingDate(now);
}

/** The calendar date an instant falls on in the operating timezone, as YYYY-MM-DD. */
export function toOperatingDate(at: Date): string {
  const shifted = new Date(at.getTime() + OPERATING_UTC_OFFSET_HOURS * 3_600_000);
  // getUTC* after shifting reads the operating-timezone wall clock. Using the plain getters
  // would read the machine's timezone, which is UTC on the server and SAST on Ashley's laptop.
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/**
 * Resolve a period to inclusive calendar dates.
 *
 * `custom` returns the range it was given; an incomplete custom range falls back to today
 * rather than throwing, because a half-filled date picker is a normal state for a form to be
 * in and should show something sensible rather than an error.
 */
export function resolvePeriod(
  key: PeriodKey,
  opts: { now?: Date; from?: string | null; to?: string | null } = {},
): DateRange {
  const now = opts.now ?? new Date();
  const today = toOperatingDate(now);

  switch (key) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const d = addDays(today, -1);
      return { from: d, to: d };
    }
    case "tomorrow": {
      const d = addDays(today, 1);
      return { from: d, to: d };
    }
    // Trailing windows include today, so "last 7 days" is today and the six before it. That
    // matches how people say it; a window that stopped at yesterday would hide this morning.
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "next7":
      return { from: today, to: addDays(today, 6) };
    case "last28":
      return { from: addDays(today, -27), to: today };
    case "this_month":
      return monthOf(today);
    case "last_month": {
      const [y, m] = today.split("-").map(Number) as [number, number];
      // Month 0 of the next year is December of this one, which Date.UTC normalises for us.
      const prev = new Date(Date.UTC(y, m - 2, 1));
      return monthOf(isoDate(prev.getUTCFullYear(), prev.getUTCMonth(), 1));
    }
    case "custom": {
      if (!opts.from || !opts.to) return { from: today, to: today };
      // Tolerate a range entered backwards rather than returning nothing at all.
      return opts.from <= opts.to
        ? { from: opts.from, to: opts.to }
        : { from: opts.to, to: opts.from };
    }
  }
}

/** The first and last calendar date of the month a given date falls in. */
export function monthOf(date: string): DateRange {
  const [y, m] = date.split("-").map(Number) as [number, number];
  // Day 0 of the following month is the last day of this one, and Date.UTC keeps it off the
  // machine's timezone — `new Date(y, m, 0)` would build a local midnight and can land on the
  // wrong day.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: isoDate(y, m - 1, 1), to: isoDate(y, m - 1, last) };
}

/** Shift a YYYY-MM-DD date by whole days, staying on the calendar rather than the clock. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/** Whole days from one calendar date to another; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The equivalent stretch immediately before a range, for period-on-period comparison. A
 * 7-day range compares against the 7 days before it, so "up 12%" always means against a
 * window of the same length.
 */
export function previousPeriod(range: DateRange): DateRange {
  const span = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -span), to: addDays(range.from, -1) };
}

/**
 * The UTC instants a calendar range covers, for querying timestamp columns. `toExclusive` is
 * the start of the day after `to`, so the comparison is `>= from && < toExclusive` and no
 * row is lost to a fractional second at the boundary.
 */
export function rangeToInstants(range: DateRange): { from: Date; toExclusive: Date } {
  const off = OPERATING_UTC_OFFSET_HOURS * 3_600_000;
  return {
    from: new Date(Date.parse(`${range.from}T00:00:00Z`) - off),
    toExclusive: new Date(Date.parse(`${addDays(range.to, 1)}T00:00:00Z`) - off),
  };
}

/** A short human label, e.g. "26 Sep" or "1 – 26 Sep 2026". */
export function formatRange(range: DateRange): string {
  const fmt = (d: string, withYear: boolean) => {
    const [y, m, day] = d.split("-").map(Number) as [number, number, number];
    const month = MONTHS[m - 1];
    return withYear ? `${day} ${month} ${y}` : `${day} ${month}`;
  };
  if (range.from === range.to) return fmt(range.from, true);
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return `${fmt(range.from, !sameYear)} – ${fmt(range.to, true)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
