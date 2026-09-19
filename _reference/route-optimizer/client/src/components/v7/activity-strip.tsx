import { useMemo, useState } from "react";
import { useDispatchData } from "@/hooks/use-dispatch-data";
import { generateInsights, type Insight, type WarningItem } from "@/lib/routing";
import { AlertTriangle, Repeat2, Lightbulb, ChevronDown, ChevronUp } from "lucide-react";
import { WarningInspector, extractWaybills } from "./warning-inspector";

type Tone = "danger" | "warning" | "info" | "neutral" | "brand" | "success";
type Kind = "alert" | "handoff" | "insight";

interface Chip {
  id: string;
  kind: Kind;
  label: string;
  detail: string;
  tone: Tone;
  weight: number;
  warning?: WarningItem;
}

const INSIGHT_TONE: Record<Insight["sev"], Tone> = {
  warning: "warning",
  tip: "info",
  info: "info",
  success: "success",
};

const TONE_BORDER: Record<Tone, string> = {
  danger: "border-l-danger",
  warning: "border-l-warning",
  info: "border-l-info",
  brand: "border-l-jacaranda-300",
  success: "border-l-success",
  neutral: "border-l-hairline",
};

const KIND_FILTERS: { id: Kind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "alert", label: "Alerts" },
  { id: "handoff", label: "Handoffs" },
  { id: "insight", label: "Insights" },
];

export function ActivityStrip() {
  const { handoffs, allWarn, tl, dayShips, trafficCond, fleet } = useDispatchData();
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [expanded, setExpanded] = useState(false);
  const [activeWarning, setActiveWarning] = useState<WarningItem | null>(null);

  const chips: Chip[] = useMemo(() => {
    const out: Chip[] = [];

    allWarn.forEach((w, i) => {
      out.push({
        id: `alert-${i}`,
        kind: "alert",
        label: w.sev === "HIGH" ? "Alert" : w.sev === "MED" ? "Warning" : "Note",
        detail: w.msg,
        tone: w.sev === "HIGH" ? "danger" : w.sev === "MED" ? "warning" : "neutral",
        weight: w.sev === "HIGH" ? 0 : w.sev === "MED" ? 1 : 3,
        warning: w,
      });
    });

    handoffs
      .filter((h) => h.status === "planned" || h.status === "confirmed")
      .forEach((h) => {
        const from = fleet.find((d) => d.id === h.fromDriverId);
        const to = fleet.find((d) => d.id === h.toDriverId);
        out.push({
          id: `handoff-${h.id}`,
          kind: "handoff",
          label: "Handoff",
          detail: `${from?.name ?? "?"} → ${to?.name ?? "?"} · ${h.plannedMeetStart ?? ""}`,
          tone: h.status === "confirmed" ? "success" : "brand",
          weight: 2,
        });
      });

    const insights = generateInsights(tl, dayShips, trafficCond, false, []);
    insights.forEach((ins, i) => {
      out.push({
        id: `insight-${i}-${ins.title}`,
        kind: "insight",
        label: ins.title,
        detail: ins.detail || ins.title,
        tone: INSIGHT_TONE[ins.sev] ?? "info",
        weight: ins.sev === "warning" ? 1 : 4,
      });
    });

    return out.sort((a, b) => a.weight - b.weight);
  }, [allWarn, handoffs, tl, dayShips, trafficCond, fleet]);

  const counts = useMemo(() => {
    const c = { all: chips.length, alert: 0, handoff: 0, insight: 0 } as Record<string, number>;
    chips.forEach((ch) => { c[ch.kind] = (c[ch.kind] || 0) + 1; });
    return c;
  }, [chips]);

  const filtered = filter === "all" ? chips : chips.filter((c) => c.kind === filter);
  const COLLAPSED_LIMIT = 6;
  const visible = expanded ? filtered : filtered.slice(0, COLLAPSED_LIMIT);
  const hiddenCount = filtered.length - visible.length;

  if (chips.length === 0) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-text-quiet" data-testid="activity-strip-empty">
        No alerts, handoffs, or insights right now.
      </div>
    );
  }

  return (
    <div data-testid="activity-strip" className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {KIND_FILTERS.map((f) => {
          const active = filter === f.id;
          const n = counts[f.id] ?? 0;
          if (f.id !== "all" && n === 0) return null;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              data-testid={`activity-filter-${f.id}`}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active
                  ? "bg-jacaranda-gradient text-white shadow-v7-sm"
                  : "border border-hairline bg-surface-raised text-text-secondary hover:text-text-primary"
              }`}
            >
              {f.label}
              <span className={`tabular-nums ${active ? "text-white/80" : "text-text-quiet"}`}>{n}</span>
            </button>
          );
        })}
      </div>

      <div
        className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        data-testid="activity-grid"
      >
        {visible.map((chip) => {
          const clickable = chip.kind === "alert" && chip.warning && extractWaybills(chip.warning.msg).length > 0;
          const Tag: any = clickable ? "button" : "div";
          return (
            <Tag
              key={chip.id}
              type={clickable ? "button" : undefined}
              onClick={clickable ? () => setActiveWarning(chip.warning!) : undefined}
              data-testid={`activity-chip-${chip.id}`}
              className={`min-w-0 text-left rounded-[var(--v7-radius-md)] border border-hairline border-l-2 ${TONE_BORDER[chip.tone]} bg-surface-raised px-3 py-2 shadow-v7-sm ${
                clickable ? "cursor-pointer transition-colors hover:bg-surface-overlay/60 hover:border-l-jacaranda-300 focus:outline-none focus:ring-2 focus:ring-jacaranda-400/40" : ""
              }`}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
                {chip.kind === "alert" && <AlertTriangle className="size-3 shrink-0 text-danger" />}
                {chip.kind === "handoff" && <Repeat2 className="size-3 shrink-0 text-jacaranda-200" />}
                {chip.kind === "insight" && <Lightbulb className="size-3 shrink-0 text-info" />}
                <span className="truncate text-text-tertiary">{chip.label}</span>
                {clickable && <span className="ml-auto text-[10px] font-normal normal-case text-text-quiet">Click to resolve</span>}
              </div>
              <div className="mt-1 text-xs leading-snug text-text-secondary line-clamp-3 break-words">
                {chip.detail}
              </div>
            </Tag>
          );
        })}
      </div>

      <WarningInspector
        open={!!activeWarning}
        warning={activeWarning}
        onClose={() => setActiveWarning(null)}
      />

      {filtered.length > COLLAPSED_LIMIT && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          data-testid="activity-toggle-expand"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-text-tertiary hover:text-text-primary"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="size-3" /> Show {hiddenCount} more
            </>
          )}
        </button>
      )}
    </div>
  );
}
