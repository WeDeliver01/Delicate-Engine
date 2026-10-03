"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LiveDriver, LiveOperations, LiveStop } from "@delicate/contracts";
import { api } from "@/lib/api";
import { minutesToClock } from "@/lib/money";
import { TrackingMap, type MapPoint } from "@/components/shipments/tracking-map";
import { Chip, Empty, PageHeader, Panel, Stat } from "@/components/ui";

const ACTIVITY_LABELS = {
  working: "On route",
  ready: "Ready",
  planned: "Planning",
  available: "Available",
  no_shift: "No shift",
  finished: "Finished",
} as const;

const SEVERITY_TONE = { warning: "bad", tip: "warn", info: "info" } as const;

/**
 * Live operations.
 *
 * Everything on this page is derived when it is asked for and stored nowhere: an ETA is only
 * true for as long as the van is where it was. That is also why it polls — the numbers are
 * worth refreshing, not worth a socket layer the engine does not otherwise have.
 *
 * Advisories come first, because the point of the screen is to be told what to do about the
 * day rather than to admire it.
 */
export default function LiveOpsPage() {
  const [selected, setSelected] = useState<string | null>(null);

  const live = useQuery({
    queryKey: ["admin", "live"],
    queryFn: () => api<LiveOperations>("/v1/admin/dispatch/live"),
    refetchInterval: 15_000,
  });

  const l = live.data;
  const working = l?.drivers.filter((d) => d.activity === "working") ?? [];
  const driver = l?.drivers.find((d) => d.driverId === selected) ?? null;
  const warnings = l?.advisories.filter((a) => a.severity === "warning").length ?? 0;
  const atRisk = working.reduce((n, d) => n + d.stops.filter((s) => s.willMissWindow).length, 0);

  const points: MapPoint[] = [
    ...(l ? [{ ...l.depot, kind: "collection" as const, label: "Depot" }] : []),
    ...working
      .filter((d) => d.location)
      .map((d) => ({
        ...d.location!,
        kind: "driver" as const,
        label: `${d.name}${d.progress ? ` · ${d.progress.done}/${d.progress.total}` : ""}`,
      })),
    // The stops of whoever is open, so the map answers "where is he going next".
    ...(driver?.stops ?? [])
      .filter((s) => s.location)
      .map((s) => ({
        ...s.location!,
        kind: "destination" as const,
        label: `${s.sequence}. ${s.address}`,
      })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Command Center"
        title="Live operations"
        lede="Where everyone is, when they will actually arrive, and what to do about it. Refreshes itself."
        actions={
          <Link href="/admin/dispatch" className="btn btn-secondary btn-sm">
            Dispatch board
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="On route" value={working.length} />
        <Stat
          label="Stops left"
          value={working.reduce(
            (n, d) =>
              n + (d.progress ? d.progress.total - d.progress.done - d.progress.skipped : 0),
            0,
          )}
        />
        <Stat label="Will miss a window" value={atRisk} tone={atRisk === 0 ? "good" : "bad"} />
        <Stat
          label="Needs you"
          value={warnings}
          tone={warnings === 0 ? "good" : "bad"}
          hint={l ? `as at ${minutesToClock(l.nowMinute)}` : undefined}
        />
      </div>

      {(l?.advisories ?? []).length > 0 && (
        <Panel title="What to look at" description="Worst first.">
          <ul className="divide-y divide-[#F0EDE9]">
            {(l?.advisories ?? []).map((a, i) => (
              <li key={`${a.title}-${i}`} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={SEVERITY_TONE[a.severity]}>{a.category}</Chip>
                  <span className="text-sm font-medium">{a.title}</span>
                  {a.driverId && (
                    <button
                      type="button"
                      onClick={() => setSelected(a.driverId)}
                      className="link-quiet text-xs"
                    >
                      show
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted">{a.detail}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <Panel
          title="Map"
          description={
            driver
              ? `${driver.name}'s remaining stops`
              : "Pick a driver to see where they are going next"
          }
        >
          <div className="panel-body">
            <TrackingMap points={points} className="h-[26rem] rounded" />
          </div>
        </Panel>

        <aside className="space-y-3">
          {(l?.drivers ?? []).length === 0 ? (
            <Empty>No active drivers.</Empty>
          ) : (
            (l?.drivers ?? []).map((d) => (
              <DriverCard
                key={d.driverId}
                d={d}
                nowMinute={l?.nowMinute ?? 0}
                open={selected === d.driverId}
                onToggle={() => setSelected(selected === d.driverId ? null : d.driverId)}
              />
            ))
          )}
        </aside>
      </div>
    </div>
  );
}

function DriverCard({
  d,
  nowMinute,
  open,
  onToggle,
}: {
  d: LiveDriver;
  nowMinute: number;
  open: boolean;
  onToggle: () => void;
}) {
  const missing = d.stops.filter((s) => s.willMissWindow).length;
  return (
    <section className={`panel ${missing > 0 ? "border-l-2 border-l-[#C13B73]" : ""}`}>
      <button type="button" onClick={onToggle} className="w-full p-4 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{d.name}</div>
            <div className="text-xs text-muted">
              {d.vehicleRegistration ?? "no vehicle"}
              {d.tripReference && ` · ${d.tripReference}`}
            </div>
          </div>
          <Chip tone={d.activity === "working" ? "good" : "outline"}>
            {ACTIVITY_LABELS[d.activity]}
          </Chip>
        </div>

        {d.progress && (
          <div className="mt-2">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted">
                {d.travelledKm > 0 ? `${d.travelledKm.toFixed(1)} km driven` : "not moved yet"}
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

        <div className="mt-2 space-y-0.5 text-xs">
          {d.silentMinutes == null ? (
            <div className="text-muted">never reported a position</div>
          ) : (
            <div className={d.silentMinutes > 45 ? "text-[#C13B73]" : "text-muted"}>
              seen {d.silentMinutes === 0 ? "just now" : `${d.silentMinutes} min ago`}
            </div>
          )}
          {d.offRouteKm > 3 && (
            <div className="text-[#8A5A12]">{d.offRouteKm.toFixed(1)} km off the line</div>
          )}
          {missing > 0 && (
            <div className="text-[#C13B73]">
              {missing} window{missing === 1 ? "" : "s"} will be missed
            </div>
          )}
        </div>
      </button>

      {open && d.stops.length > 0 && (
        <ol className="divide-y divide-[#F0EDE9] border-t border-line text-xs">
          {d.stops.map((s) => (
            <StopRow key={s.stopId} s={s} nowMinute={nowMinute} />
          ))}
        </ol>
      )}
      {open && d.stops.length === 0 && (
        <p className="border-t border-line p-4 text-xs text-muted">Nothing left to do today.</p>
      )}
    </section>
  );
}

function StopRow({ s, nowMinute }: { s: LiveStop; nowMinute: number }) {
  const window =
    s.window.startMinute != null && s.window.endMinute != null
      ? `${minutesToClock(s.window.startMinute)}–${minutesToClock(s.window.endMinute)}`
      : null;
  const past = s.window.endMinute != null && s.window.endMinute < nowMinute;
  return (
    <li className="flex items-start gap-2 px-4 py-2">
      <span className="figure w-4 shrink-0 text-center">{s.sequence}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {s.kind === "collection" ? "Collect · " : ""}
          {s.address}
        </div>
        <div className="text-muted">
          {s.waybill ?? "collection"}
          {window && (
            <span className={past || s.willMissWindow ? " text-[#C13B73]" : ""}> · {window}</span>
          )}
        </div>
      </div>
      <div className="w-16 shrink-0 text-right">
        <div className={`figure ${s.willMissWindow ? "text-[#C13B73]" : ""}`}>
          {s.etaMinute == null ? "—" : minutesToClock(s.etaMinute)}
        </div>
        {s.varianceMinutes != null && s.varianceMinutes !== 0 && (
          <div className={s.varianceMinutes > 0 ? "text-[#C13B73]" : "text-[#1B7F4B]"}>
            {s.varianceMinutes > 0 ? "+" : ""}
            {s.varianceMinutes}m
          </div>
        )}
      </div>
    </li>
  );
}
