"use client";

import { useMemo, useState } from "react";
import type { SlotAvailability } from "@delicate/contracts";

/**
 * Pick a delivery date from a month, then a window within it.
 *
 * It used to be a row of pills, one per open date. That works for the next few days and falls
 * apart beyond them: twelve identical capsules reading "Mon, 12 Oct" are a date only if you
 * read every one, and a customer sending a cake to a birthday knows the date, not its position
 * in a row. A month is how people hold a date in their head, so that is what we show.
 *
 * The engine returns availability per date and window, and leaves non-operating days out
 * entirely. So a day with no entry is a day we do not deliver, a day whose windows are all
 * closed says why, and everything else is open. All three look different here, because "you
 * cannot have Sunday" and "Tuesday is full" are different problems for the person booking.
 */
export function SlotCalendar({
  slots,
  value,
  onChange,
}: {
  slots: SlotAvailability[];
  value: { date: string; windowKey: string } | null;
  onChange: (v: { date: string; windowKey: string } | null) => void;
}) {
  const byDate = useMemo(() => {
    const map = new Map<string, SlotAvailability[]>();
    for (const s of slots) map.set(s.date, [...(map.get(s.date) ?? []), s]);
    return map;
  }, [slots]);

  const dates = useMemo(() => [...byDate.keys()].sort(), [byDate]);
  const firstOpen = useMemo(
    () => dates.find((d) => byDate.get(d)!.some((s) => s.bookable)) ?? dates[0] ?? null,
    [dates, byDate],
  );

  const [day, setDay] = useState<string | null>(null);
  const selectedDay = day ?? firstOpen;
  // Only as far as the engine will quote: paging into an empty December invites someone to
  // ask why none of it is available.
  const firstMonth = monthOf(dates[0] ?? selectedDay);
  const lastMonth = monthOf(dates[dates.length - 1] ?? selectedDay);
  const [month, setMonth] = useState<string | null>(null);
  const shown = clampMonth(month ?? monthOf(selectedDay) ?? firstMonth, firstMonth, lastMonth);

  if (!shown || dates.length === 0) {
    return <p className="mt-3 text-sm text-muted">No delivery dates are open at the moment.</p>;
  }

  /** Changing the day drops the window with it — the old one belonged to the old date. */
  function pickDay(date: string) {
    setDay(date);
    if (value && value.date !== date) onChange(null);
  }

  const windows = selectedDay ? (byDate.get(selectedDay) ?? []) : [];

  return (
    <div className="mt-3 space-y-4 text-sm">
      <div className="rounded-xl border border-line p-3">
        <div className="flex items-center justify-between">
          <MonthStep
            label="Previous month"
            glyph="chevron_left"
            to={addMonths(shown, -1)}
            min={firstMonth}
            max={lastMonth}
            onPick={setMonth}
          />
          <p className="font-medium text-ink">{monthLabel(shown)}</p>
          <MonthStep
            label="Next month"
            glyph="chevron_right"
            to={addMonths(shown, 1)}
            min={firstMonth}
            max={lastMonth}
            onPick={setMonth}
          />
        </div>

        {/* Monday first: the working week reads as a block and Sunday, which we are closed, sits
            at the end rather than splitting it in two. */}
        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-wide text-muted">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <span key={d}>{d.slice(0, 1)}</span>
          ))}
        </div>

        <div className="mt-1 grid grid-cols-7 gap-1">
          {cellsOf(shown).map((date, i) =>
            date === null ? (
              <span key={`pad-${i}`} />
            ) : (
              <DayCell
                key={date}
                date={date}
                slots={byDate.get(date) ?? null}
                selected={date === selectedDay}
                onPick={pickDay}
              />
            ),
          )}
        </div>
      </div>

      {selectedDay && (
        <div className="space-y-2">
          <p className="label-mini">{longDate(selectedDay)}</p>
          {windows.length === 0 ? (
            <p className="text-sm text-muted">We do not deliver on this day.</p>
          ) : (
            windows.map((s) => {
              const selected = value?.date === s.date && value?.windowKey === s.windowKey;
              return (
                <button
                  key={s.windowKey}
                  type="button"
                  disabled={!s.bookable}
                  onClick={() => onChange({ date: s.date, windowKey: s.windowKey })}
                  className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition-colors disabled:opacity-40 ${
                    selected ? "border-ink bg-[#FAFAF9]" : "border-line"
                  }`}
                >
                  <span>{s.label}</span>
                  <span className="text-xs text-muted">
                    {s.bookable ? `${s.remaining} left` : reasonText(s.closedReason)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function DayCell({
  date,
  slots,
  selected,
  onPick,
}: {
  date: string;
  slots: SlotAvailability[] | null;
  selected: boolean;
  onPick: (date: string) => void;
}) {
  const open = slots?.some((s) => s.bookable) ?? false;
  const left = slots?.reduce((n, s) => n + (s.bookable ? s.remaining : 0), 0) ?? 0;
  const title = open
    ? `${longDate(date)} — ${left} ${left === 1 ? "space" : "spaces"} left`
    : `${longDate(date)} — ${slots ? reasonText(firstReason(slots)) : "we do not deliver on this day"}`;

  return (
    <button
      type="button"
      disabled={!open}
      onClick={() => onPick(date)}
      title={title}
      aria-label={title}
      aria-pressed={selected}
      className={`relative h-9 rounded-lg text-sm transition-colors ${
        selected
          ? "bg-ink font-medium text-white"
          : open
            ? "text-ink hover:bg-[#F4F1EC]"
            : "cursor-not-allowed text-[#C9C4BC]"
      }`}
    >
      {Number(date.slice(8, 10))}
      {/* A dot rather than a number: how full a day is matters, exactly how full does not
          until you have chosen it, and twelve small numbers make a grid unreadable. */}
      {open && !selected && (
        <span className="absolute inset-x-0 bottom-1 mx-auto block h-1 w-1 rounded-full bg-brand-pink" />
      )}
    </button>
  );
}

function MonthStep({
  label,
  glyph,
  to,
  min,
  max,
  onPick,
}: {
  label: string;
  glyph: string;
  to: string;
  min: string | null;
  max: string | null;
  onPick: (m: string) => void;
}) {
  const allowed = (!min || to >= min) && (!max || to <= max);
  return (
    <button
      type="button"
      disabled={!allowed}
      onClick={() => onPick(to)}
      aria-label={label}
      className="rounded-lg p-1 text-muted transition-colors hover:bg-[#F4F1EC] hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <span className="material-symbols-outlined block text-[20px]" aria-hidden="true">
        {glyph}
      </span>
    </button>
  );
}

/** Why a day is shut, in words a customer can act on. */
function reasonText(reason: SlotAvailability["closedReason"]): string {
  switch (reason) {
    case "full":
      return "fully booked";
    case "closed":
      return "closed";
    case "blackout":
      return "we are closed that day";
    case "cutoff_passed":
      return "too late to book";
    case "lead_time":
      return "too soon";
    default:
      return "unavailable";
  }
}

function firstReason(slots: SlotAvailability[]): SlotAvailability["closedReason"] {
  return slots.find((s) => s.closedReason)?.closedReason ?? null;
}

/*
  Dates are plain `YYYY-MM-DD` strings and stay that way. Turning them into Date objects to do
  arithmetic is how a booking lands on the wrong day for somebody in another timezone, so the
  only Date built here is one at local midnight, purely to be formatted.
*/

const monthOf = (date: string | null): string | null => (date ? date.slice(0, 7) : null);

function addMonths(month: string, by: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + by;
  const year = y + Math.floor(m / 12);
  const norm = ((m % 12) + 12) % 12;
  return `${year}-${String(norm + 1).padStart(2, "0")}`;
}

function clampMonth(month: string | null, min: string | null, max: string | null): string | null {
  if (!month) return null;
  if (min && month < min) return min;
  if (max && month > max) return max;
  return month;
}

/** The month as a grid: leading blanks for the days before the first, then every date in it. */
function cellsOf(month: string): (string | null)[] {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const first = new Date(year, index, 1);
  const lead = (first.getDay() + 6) % 7; // Sunday is 0 in JS; we start on Monday.
  const days = new Date(year, index + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  return cells;
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString("en-ZA", {
    month: "long",
    year: "numeric",
  });
}

function longDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
