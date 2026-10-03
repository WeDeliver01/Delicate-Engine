"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BOARD_EXCEPTION_LABELS,
  BOARD_LANE_LABELS,
  type AssignmentRecommendation,
  type BoardCard,
  type BoardDriver,
  type BoardExceptionKind,
  type BoardLane,
  type DispatchBoard,
} from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { minutesToClock, rands } from "@/lib/money";
import { Chip, Empty, PageHeader, Panel } from "@/components/ui";

/** Left to right is the order work actually moves through the day. */
const LANES: BoardLane[] = [
  "unassigned",
  "awaiting_driver",
  "en_route_collection",
  "collected",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "failed",
];

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
          onAssigned={() => {
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
  onAssigned,
}: {
  card: BoardCard;
  date: string;
  onClose: () => void;
  onError: (e: unknown) => void;
  onAssigned: () => void;
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
    onSuccess: onAssigned,
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
