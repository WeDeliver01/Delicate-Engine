"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BOARD_EXCEPTION_LABELS,
  BOARD_LANE_LABELS,
  BoardLane,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_TRANSITIONS,
  type AssignmentRecommendation,
  type BoardCard,
  type BoardDriver,
  type BoardExceptionKind,
  type DispatchBoard,
  type ShipmentStatus,
} from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { minutesToClock, rands } from "@/lib/money";
import { Chip, Empty, PageHeader, Panel } from "@/components/ui";

/**
 * Left to right is the order work actually moves through the day. Taken off the contract so
 * that adding a lane adds a column, rather than adding a lane no dispatcher can see.
 */
const LANES: BoardLane[] = BoardLane.options;

const ACTIVITY_TONE = {
  working: "good",
  ready: "info",
  planned: "neutral",
  available: "outline",
  no_shift: "outline",
  finished: "outline",
} as const;

const ACTIVITY_LABELS = {
  working: "On route",
  ready: "Ready",
  planned: "Planning",
  available: "Available",
  no_shift: "No shift",
  finished: "Finished",
} as const;

/**
 * The dispatch board: one screen that runs the day.
 *
 * Lanes are columns because that is the shape of the question a dispatcher asks all morning —
 * what has not moved yet. Exceptions are not a lane: a late shipment is still in transit, and
 * moving its card into a bin marked "exception" loses the one fact needed to act on it. So the
 * card is marked where it stands, and the filter above narrows to them.
 */
export default function DispatchBoardPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [only, setOnly] = useState<BoardExceptionKind | null>(null);
  const [open, setOpen] = useState<BoardCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));

  const board = useQuery({
    queryKey: ["admin", "board", date],
    queryFn: () => api<DispatchBoard>(`/v1/admin/dispatch/board?date=${date}`),
    refetchInterval: 15_000,
  });

  const b = board.data;
  const cards = (b?.cards ?? []).filter((c) => !only || c.exceptions.includes(only));
  const exceptions = Object.entries(b?.exceptionCounts ?? {}).filter(([, n]) => n > 0) as [
    BoardExceptionKind,
    number,
  ][];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Command Center"
        title="Dispatch board"
        lede="Today, by where it has got to. Cards carry what needs a person; nothing is hidden in a bin."
        actions={
          <>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input"
              aria-label="Board date"
            />
            <Link href="/admin/trips" className="btn btn-secondary btn-sm">
              Trips
            </Link>
          </>
        }
      />

      {error && <p className="alert-error">{error}</p>}

      {exceptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-mini">Needs a person</span>
          {exceptions.map(([kind, n]) => (
            <button
              key={kind}
              type="button"
              onClick={() => setOnly(only === kind ? null : kind)}
              className={`chip ${only === kind ? "chip-bad" : "chip-outline"}`}
            >
              {BOARD_EXCEPTION_LABELS[kind]} · {n}
            </button>
          ))}
          {only && (
            <button type="button" onClick={() => setOnly(null)} className="link-quiet text-xs">
              clear
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <div className="min-w-0 overflow-x-auto">
          <div className="flex gap-3" style={{ minWidth: `${LANES.length * 15}rem` }}>
            {LANES.map((lane) => {
              const mine = cards.filter((c) => c.lane === lane);
              return (
                <section key={lane} className="flex-1 space-y-2">
                  <header className="flex items-baseline justify-between px-1">
                    <h2 className="label-mini">{BOARD_LANE_LABELS[lane]}</h2>
                    <span className="figure text-xs">{b?.laneCounts[lane] ?? 0}</span>
                  </header>
                  {mine.length === 0 ? (
                    <p className="rounded border border-dashed border-[#E6E1DA] p-3 text-center text-xs text-muted">
                      —
                    </p>
                  ) : (
                    mine.map((c) => (
                      <Card
                        key={c.shipmentId}
                        card={c}
                        nowMinute={b?.nowMinute ?? 0}
                        onOpen={() => setOpen(c)}
                      />
                    ))
                  )}
                </section>
              );
            })}
          </div>
        </div>

        <aside className="space-y-3">
          <Panel title="Drivers" description={`${b?.drivers.length ?? 0} active`}>
            {(b?.drivers ?? []).length === 0 ? (
              <Empty>No active drivers.</Empty>
            ) : (
              <ul className="divide-y divide-[#F0EDE9]">
                {(b?.drivers ?? []).map((d) => (
                  <Rail key={d.driverId} d={d} />
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>

      {open && (
        <CardDialog
          card={open}
          date={date}
          onClose={() => setOpen(null)}
          onError={onError}
          onDone={() => {
            setOpen(null);
            setError(null);
            void qc.invalidateQueries({ queryKey: ["admin", "board"] });
          }}
        />
      )}
    </div>
  );
}

function Card({
  card,
  nowMinute,
  onOpen,
}: {
  card: BoardCard;
  nowMinute: number;
  onOpen: () => void;
}) {
  const late = card.exceptions.includes("behind_schedule") || card.exceptions.includes("overdue");
  const window =
    card.window?.startMinute != null && card.window.endMinute != null
      ? `${minutesToClock(card.window.startMinute)}–${minutesToClock(card.window.endMinute)}`
      : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`panel w-full p-3 text-left transition-shadow hover:shadow-md ${
        late ? "border-l-2 border-l-[#C13B73]" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs font-medium">{card.waybill}</span>
        {card.stopSequence != null && (
          <span className="chip chip-outline shrink-0">#{card.stopSequence}</span>
        )}
      </div>
      <div className="mt-1 truncate text-sm">
        {card.delivery.address.suburb ?? card.delivery.address.formatted}
      </div>
      <div className="truncate text-xs text-muted">
        from {card.collection.address.suburb ?? "—"} · {card.accountName}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {card.driverName && <Chip tone="neutral">{card.driverName.split(" ")[0]}</Chip>}
        {window && (
          <Chip tone={late ? "bad" : card.window?.source === "pinned" ? "info" : "outline"}>
            {window}
          </Chip>
        )}
        {card.serviceLevelCode === "on_demand" && <Chip tone="warn">on demand</Chip>}
      </div>
      {card.exceptions.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {card.exceptions.map((e) => (
            <div key={e} className="text-[11px] text-[#C13B73]">
              {BOARD_EXCEPTION_LABELS[e]}
              {e === "behind_schedule" && card.window?.endMinute != null && (
                <span className="text-muted"> · {nowMinute - card.window.endMinute} min over</span>
              )}
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

function Rail({ d }: { d: BoardDriver }) {
  return (
    <li className="px-5 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{d.name}</div>
          <div className="text-xs text-muted">{d.vehicleRegistration ?? "no vehicle"}</div>
        </div>
        <Chip tone={ACTIVITY_TONE[d.activity]}>{ACTIVITY_LABELS[d.activity]}</Chip>
      </div>
      {d.progress && (
        <div className="mt-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted">
              {d.tripReference ? (
                <Link href={`/admin/trips/${d.tripId}`} className="link-quiet">
                  {d.tripReference}
                </Link>
              ) : (
                "no trip"
              )}
            </span>
            <span className="figure">
              {d.progress.done}/{d.progress.total}
            </span>
          </div>
          <div className="mt-1 h-1 rounded bg-[#F0EDE9]">
            <div
              className="h-1 rounded bg-[#1B7F4B]"
              style={{
                width: `${d.progress.total === 0 ? 0 : (d.progress.done / d.progress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}
      {d.currentStop && (
        <div className="mt-2 text-xs">
          <span className="text-muted">
            {d.currentStop.kind === "collection" ? "collecting at" : "delivering to"}{" "}
          </span>
          {d.currentStop.address}
        </div>
      )}
      {d.behindCount > 0 && (
        <div className="mt-1 text-xs text-[#C13B73]">
          {d.behindCount} stop{d.behindCount === 1 ? "" : "s"} past its window
        </div>
      )}
      {d.lastSeen && (
        <div className="mt-1 text-[11px] text-muted">
          seen {d.lastSeen.ageMinutes === 0 ? "just now" : `${d.lastSeen.ageMinutes} min ago`}
        </div>
      )}
    </li>
  );
}

/**
 * Everything about one shipment, plus who should take it.
 *
 * The recommendation shows its reason rather than just a name: a dispatcher who cannot see why
 * a driver was suggested either follows it blindly or stops reading it, and both are worse than
 * no suggestion.
 */
function CardDialog({
  card,
  date,
  onClose,
  onError,
  onDone,
}: {
  card: BoardCard;
  date: string;
  onClose: () => void;
  onError: (e: unknown) => void;
  /** Called after anything that moves the card, so the board is re-read. */
  onDone: () => void;
}) {
  const recs = useQuery({
    queryKey: ["admin", "board", "recs", card.shipmentId],
    queryFn: () =>
      api<AssignmentRecommendation[]>(
        `/v1/admin/dispatch/board/recommendations/${card.shipmentId}`,
      ),
    enabled: card.status === "booked" || card.status === "assigned",
  });
  const assign = useMutation({
    mutationFn: (driverId: string) =>
      api<{ tripId: string }>("/v1/admin/dispatch/board/assign", {
        method: "POST",
        json: { shipmentId: card.shipmentId, driverId, date },
      }),
    onSuccess: onDone,
    onError,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
      <div className="panel my-8 w-full max-w-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="section-title font-mono">{card.waybill}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {card.bookingReference}
              {card.customerReference && ` · their ref ${card.customerReference}`} ·{" "}
              {card.accountName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip tone="info">{BOARD_LANE_LABELS[card.lane]}</Chip>
            <button type="button" onClick={onClose} className="link-quiet text-sm">
              close
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Leg
            title="Collect"
            address={card.collection.address.formatted}
            contact={card.collection.contact}
          />
          <Leg
            title="Deliver"
            address={card.delivery.address.formatted}
            contact={card.delivery.contact}
          />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Service" value={card.serviceLevelCode} />
          <Fact
            label="Slot"
            value={card.slotDate ? `${card.slotDate} ${card.slotWindowKey ?? ""}` : "on demand"}
          />
          <Fact label="Price" value={rands(card.priceCents)} />
          <Fact
            label="Declared"
            value={card.declaredValueCents ? rands(card.declaredValueCents) : "—"}
          />
          <Fact label="Parcels" value={String(card.parcels.reduce((n, p) => n + p.quantity, 0))} />
          <Fact label="Driver" value={card.driverName ?? "none"} />
          <Fact label="Trip" value={card.tripReference ?? "none"} />
          <Fact
            label="Window"
            value={
              card.window?.startMinute != null && card.window.endMinute != null
                ? `${minutesToClock(card.window.startMinute)}–${minutesToClock(card.window.endMinute)}`
                : "any time"
            }
          />
        </dl>

        {card.instructions && (
          <p className="mt-4 rounded bg-[#FBF7F0] p-3 text-sm text-[#8A5A12]">
            {card.instructions}
          </p>
        )}

        {card.exceptions.length > 0 && (
          <ul className="mt-4 space-y-1">
            {card.exceptions.map((e) => (
              <li key={e} className="text-sm text-[#C13B73]">
                {BOARD_EXCEPTION_LABELS[e]}
              </li>
            ))}
          </ul>
        )}

        {recs.isSuccess && recs.data.length > 0 && (
          <div className="mt-5">
            <h3 className="label-mini">Suggested driver</h3>
            <ul className="mt-2 divide-y divide-[#F0EDE9]">
              {recs.data.map((r, i) => (
                <li key={r.driverId} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {r.name}
                      {i === 0 && <span className="ml-2 chip chip-good">best</span>}
                    </div>
                    <div className="text-xs text-muted">{r.reason}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => assign.mutate(r.driverId)}
                    disabled={assign.isPending}
                    className="btn btn-secondary btn-sm shrink-0"
                  >
                    {r.tripReference ? "Add to day" : "Start a day"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {recs.isSuccess && recs.data.length === 0 && (
          <p className="mt-5 text-sm text-muted">
            No driver has a shift with spare capacity for this date. Schedule one on the{" "}
            <Link href="/admin/drivers" className="link-quiet">
              fleet desk
            </Link>
            .
          </p>
        )}

        <StatusControl card={card} onError={onError} onDone={onDone} />

        <div className="mt-5 flex justify-end gap-2">
          <Link
            href={`/admin/shipments?search=${card.waybill}`}
            className="btn btn-secondary btn-sm"
          >
            Open shipment
          </Link>
          {card.tripId && (
            <Link href={`/admin/trips/${card.tripId}`} className="btn btn-primary btn-sm">
              Open trip
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Moving a shipment by hand.
 *
 * Only the statuses reachable from where it is now, read off the same transition table the
 * engine enforces — so the console cannot ask for a move the engine will refuse, and a
 * dispatcher is not left guessing which of ten words is allowed.
 *
 * `returned_to_sender` lives here rather than in the driver's app on purpose: ending the job
 * bears on what the customer is charged, and that is a dispatcher's decision.
 */
function StatusControl({
  card,
  onError,
  onDone,
}: {
  card: BoardCard;
  onError: (e: unknown) => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<ShipmentStatus | null>(null);
  // Cancelling has to release the wallet hold and the slot, which a status change does not,
  // so it is the booking's own action and the engine refuses it here. Not offered rather than
  // offered and rejected.
  const next = SHIPMENT_TRANSITIONS[card.status].filter((x) => x !== "cancelled");

  const move = useMutation({
    mutationFn: (status: ShipmentStatus) =>
      api(`/v1/admin/dispatch/shipments/${card.shipmentId}/status`, {
        method: "POST",
        json: { status, note: note.trim() || undefined },
      }),
    onSuccess: onDone,
    onError,
  });

  if (next.length === 0) {
    return (
      <p className="mt-5 text-sm text-muted">
        {SHIPMENT_STATUS_LABELS[card.status]} — nothing further happens to this shipment.
      </p>
    );
  }

  const needsNote = picked ? NOTE_REQUIRED.includes(picked) : false;
  return (
    <div className="mt-5 border-t border-[#F0EDE9] pt-4">
      <h3 className="label-mini">Move this shipment</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {next.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setPicked(status === picked ? null : status)}
            className={`btn btn-sm ${status === picked ? "btn-primary" : "btn-secondary"}`}
          >
            {SHIPMENT_STATUS_LABELS[status]}
          </button>
        ))}
      </div>
      {picked && (
        <div className="mt-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              needsNote
                ? "Why — the customer will ask, and this is the answer"
                : "A note, if it helps (optional)"
            }
            maxLength={300}
            className="input w-full"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-muted">
              {picked === "delivered"
                ? "No proof of delivery is captured this way. Prefer the driver's app."
                : needsNote
                  ? "Recorded on the tracking timeline and sent to the customer."
                  : "Recorded on the tracking timeline."}
            </p>
            <button
              type="button"
              disabled={move.isPending || (needsNote && note.trim().length < 3)}
              onClick={() => move.mutate(picked)}
              className="btn btn-primary btn-sm shrink-0"
            >
              Mark {SHIPMENT_STATUS_LABELS[picked].toLowerCase()}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The moves a customer rings up about. "On hold" with no reason is tomorrow morning's support
 * call, and a delivery recorded without the driver's proof needs a person's name against it.
 */
const NOTE_REQUIRED: ShipmentStatus[] = ["on_hold", "returned_to_sender", "failed", "delivered"];

function Leg({
  title,
  address,
  contact,
}: {
  title: string;
  address: string;
  contact: { name: string; phone: string } | null;
}) {
  return (
    <div>
      <div className="label-mini">{title}</div>
      <div className="mt-1 text-sm">{address}</div>
      <div className="text-xs text-muted">
        {contact ? `${contact.name} · ${contact.phone}` : "no contact"}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-mini">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}
