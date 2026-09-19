import { ArrowRight, Fuel, Clock, Package, Route, Workflow, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Insight, InsightCategory, InsightSeverity } from "@/lib/routing";

export type InsightGroup = "fuel" | "punctuality" | "capacity" | "corridors" | "handoffs";

export const INSIGHT_GROUPS: { id: InsightGroup; label: string; icon: typeof Fuel }[] = [
  { id: "fuel", label: "Fuel", icon: Fuel },
  { id: "punctuality", label: "Punctuality", icon: Clock },
  { id: "capacity", label: "Capacity", icon: Package },
  { id: "corridors", label: "Corridors", icon: Route },
  { id: "handoffs", label: "Handoffs", icon: Workflow },
];

export function groupForCategory(cat: InsightCategory): InsightGroup {
  switch (cat) {
    case "fuel": return "fuel";
    case "punctuality": return "punctuality";
    case "capacity": return "capacity";
    case "road":
    case "alternative":
      return "corridors";
    case "general":
    default:
      return "handoffs";
  }
}

export function confidenceForInsight(sev: InsightSeverity): 1 | 2 | 3 {
  switch (sev) {
    case "warning": return 3;
    case "success": return 2;
    case "info": return 2;
    case "tip": return 1;
    default: return 2;
  }
}

function severityAccent(sev: InsightSeverity): string {
  switch (sev) {
    case "warning": return "before:bg-warning";
    case "success": return "before:bg-success";
    case "info": return "before:bg-info";
    case "tip": return "before:bg-jacaranda-400";
    default: return "before:bg-hairline";
  }
}

export type InsightAction =
  | { kind: "driver"; label: string; driverId: string }
  | { kind: "navigate"; label: string; path: string };

export function resolveInsightAction(insight: Insight): InsightAction | null {
  if (insight.driver) {
    return {
      kind: "driver",
      label: "Open driver trip",
      driverId: insight.driver,
    };
  }

  const group = groupForCategory(insight.cat);
  switch (group) {
    case "corridors":
      if (insight.cat === "alternative") {
        return { kind: "navigate", label: "Open fleet", path: "/fleet" };
      }
      return { kind: "navigate", label: "Inspect corridor", path: "/traffic" };
    case "fuel":
    case "punctuality":
    case "capacity":
      return { kind: "navigate", label: "View shipments", path: "/live" };
    case "handoffs":
    default: {
      const text = `${insight.title} ${insight.detail}`.toLowerCase();
      if (text.includes("traffic")) {
        return { kind: "navigate", label: "Inspect corridor", path: "/traffic" };
      }
      return { kind: "navigate", label: "View shipments", path: "/live" };
    }
  }
}

interface InsightCardProps {
  insight: Insight;
  index: number;
  onAction?: (insight: Insight, action: InsightAction) => void;
}

export function InsightCard({ insight, index, onAction }: InsightCardProps) {
  const confidence = confidenceForInsight(insight.sev);
  const accent = severityAccent(insight.sev);
  const action = resolveInsightAction(insight);
  const interactive = !!action && !!onAction;

  function handleActivate() {
    if (action && onAction) onAction(insight, action);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (!interactive) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleActivate();
    }
  }

  return (
    <article
      data-testid={`v7-insight-${index}`}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? handleActivate : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      className={[
        "group relative overflow-hidden rounded-[var(--v7-radius-lg,12px)]",
        "border border-hairline bg-surface-raised p-5 shadow-v7-sm",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
        accent,
        "[transition:transform_var(--v7-duration-base)_var(--v7-ease-standard),box-shadow_var(--v7-duration-base)_var(--v7-ease-standard)]",
        interactive
          ? "cursor-pointer hover:shadow-v7-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jacaranda-400/60"
          : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3
            className="text-[18px] font-medium tracking-tight text-text-primary leading-snug"
            data-testid={`v7-insight-title-${index}`}
          >
            {insight.title}
          </h3>
          {insight.driver && (
            <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-text-quiet">
              {insight.driver}
            </p>
          )}
        </div>
        <ConfidenceDots level={confidence} />
      </div>

      <p
        className="mt-3 text-[13px] leading-relaxed text-text-secondary"
        data-testid={`v7-insight-detail-${index}`}
      >
        {insight.detail}
      </p>

      <div className="mt-5 flex items-center justify-between gap-3">
        {action ? (
          <Button
            size="sm"
            variant="ghost"
            className="px-2 -ml-2 text-jacaranda-300 hover:text-jacaranda-200"
            onClick={(e) => {
              e.stopPropagation();
              handleActivate();
            }}
            data-testid={`v7-insight-action-${index}`}
          >
            {action.label}
            <ArrowRight className="size-3.5" />
          </Button>
        ) : (
          <span className="text-[11px] text-text-quiet">Informational</span>
        )}
        <span className="text-[10px] uppercase tracking-[0.18em] text-text-quiet">
          {insight.sev}
        </span>
      </div>
    </article>
  );
}

function ConfidenceDots({ level }: { level: 1 | 2 | 3 }) {
  return (
    <div
      className="flex items-center gap-1 shrink-0"
      title={`Confidence ${level}/3`}
      aria-label={`Confidence ${level} of 3`}
      data-testid={`v7-insight-confidence-${level}`}
    >
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={[
            "h-1.5 w-1.5 rounded-full",
            i <= level ? "bg-jacaranda-400" : "bg-hairline",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

export function EmptyInsights() {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-[var(--v7-radius-lg,12px)] border border-dashed border-hairline bg-surface-raised/40 p-12 text-center"
      data-testid="v7-insights-empty"
    >
      <Sparkles className="size-6 text-text-quiet mb-3" />
      <p className="text-[14px] font-medium text-text-primary">No insights yet</p>
      <p className="mt-1 max-w-sm text-[12px] text-text-secondary">
        Once shipments and trips are loaded, the engine will surface fuel, punctuality,
        capacity, corridor, and handoff opportunities here.
      </p>
    </div>
  );
}
