import { useCallback, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useDispatchData, useDispatchTabBody } from "@/hooks/use-dispatch-data";
import { useInspectorStore } from "@/stores/inspector-store";
import { useToast } from "@/hooks/use-toast";
import { refreshAfterAssign } from "@/lib/refresh-after-assign";
import {
  InsightCard,
  EmptyInsights,
  INSIGHT_GROUPS,
  groupForCategory,
  type InsightGroup,
  type InsightAction,
} from "@/components/v7/insight-card";
import { TripSheet } from "@/components/v7/trip-sheet";
import { ChevronRight } from "lucide-react";
import type { Insight } from "@/lib/routing";
import type { Driver, Stop } from "@shared/schema";

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Good evening, Operations.";
  if (h < 12) return "Good morning, Operations.";
  if (h < 17) return "Good afternoon, Operations.";
  return "Good evening, Operations.";
}

function summarise(insights: Insight[]): string {
  if (!insights.length) return "All quiet on the network — no opportunities surfaced for this view.";
  const warnings = insights.filter((i) => i.sev === "warning").length;
  const tips = insights.filter((i) => i.sev === "tip").length;
  const successes = insights.filter((i) => i.sev === "success").length;
  const parts: string[] = [];
  if (warnings) parts.push(`${warnings} watch-item${warnings === 1 ? "" : "s"}`);
  if (tips) parts.push(`${tips} optimisation${tips === 1 ? "" : "s"}`);
  if (successes) parts.push(`${successes} win${successes === 1 ? "" : "s"}`);
  const tail = parts.length ? parts.join(" · ") : `${insights.length} insight${insights.length === 1 ? "" : "s"}`;
  return `${tail} across the active fleet today.`;
}

function InsightsHero({ insights }: { insights: Insight[] }) {
  return (
    <header
      className="rounded-[var(--v7-radius-lg,12px)] border border-hairline bg-surface-raised px-8 py-7 shadow-v7-sm"
      data-testid="v7-insights-hero"
    >
      <p className="text-[10px] uppercase tracking-[0.22em] text-text-quiet">Insights</p>
      <h1
        className="mt-2 font-display text-[36px] leading-tight text-text-primary"
        data-testid="v7-insights-greeting"
      >
        {greeting()}
      </h1>
      <p className="mt-3 max-w-2xl text-[14px] text-text-secondary" data-testid="v7-insights-summary">
        {summarise(insights)}
      </p>
    </header>
  );
}

function InsightsBoard({
  insights,
  onAction,
}: {
  insights: Insight[];
  onAction: (insight: Insight, action: InsightAction) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<InsightGroup, Insight[]>();
    INSIGHT_GROUPS.forEach((g) => map.set(g.id, []));
    insights.forEach((i) => {
      const g = groupForCategory(i.cat);
      map.get(g)!.push(i);
    });
    return map;
  }, [insights]);

  if (!insights.length) return <EmptyInsights />;

  return (
    <div className="space-y-10">
      {INSIGHT_GROUPS.map(({ id, label, icon: Icon }) => {
        const list = grouped.get(id) ?? [];
        if (!list.length) return null;
        return (
          <section key={id} data-testid={`v7-insight-group-${id}`}>
            <div className="flex items-center gap-3 mb-4">
              <Icon className="size-4 text-text-tertiary" />
              <h2 className="font-display text-[20px] text-text-primary">{label}</h2>
              <span className="text-[11px] uppercase tracking-[0.18em] text-text-quiet">
                {list.length} insight{list.length === 1 ? "" : "s"}
              </span>
              <div className="ml-2 h-px flex-1 bg-hairline" />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {list.map((insight, i) => (
                <InsightCard
                  key={`${id}-${i}-${insight.title}`}
                  insight={insight}
                  index={i}
                  onAction={onAction}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function InsightsView() {
  const { insights, fleet, tl, asgn, setAsgn, log } = useDispatchData();
  const openWith = useInspectorStore((s) => s.openWith);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleReassignFromInspector = useCallback(
    (driver: Driver) => (stop: Stop, toDriverId: string) => {
      const shipIds = stop.ids ?? [];
      if (!shipIds.length) return;
      const toDriver = fleet.find((d) => d.id === toDriverId);
      const next = { ...asgn };
      shipIds.forEach((sid) => {
        next[sid] = toDriverId;
      });
      setAsgn(next);
      const label = stop.wbs?.length ? stop.wbs.join(", ") : (stop.sub || stop.addr || "Stop");
      log(`Reassigned ${label} from ${driver.name} to ${toDriver?.name || toDriverId}`, "MANUAL");
      toast({ title: "Shipment reassigned", description: `${label} moved to ${toDriver?.name || toDriverId}` });
      refreshAfterAssign(queryClient);
    },
    [fleet, asgn, setAsgn, log, toast, queryClient],
  );

  const handleAction = useCallback(
    (_insight: Insight, action: InsightAction) => {
      if (action.kind === "navigate") {
        setLocation(action.path);
        return;
      }
      // action.kind === "driver"
      const driver = fleet.find((d) => d.id === action.driverId);
      const trip = tl[action.driverId];
      if (!driver || !trip) {
        // No trip data available — fall back to the fleet page so the user can find the driver.
        setLocation("/fleet");
        return;
      }
      openWith({
        kind: "custom",
        title: `${driver.name} · Trip Sheet`,
        node: (
          <TripSheet
            driverId={driver.id}
            driver={driver}
            trip={trip}
            fleet={fleet}
            onReassignStop={handleReassignFromInspector(driver)}
          />
        ),
      });
    },
    [fleet, tl, openWith, setLocation, handleReassignFromInspector],
  );

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto max-w-7xl px-8 py-8 space-y-8" data-testid="v7-insights-page">
        <InsightsHero insights={insights} />
        <div className="flex items-center justify-between">
          <p className="text-[12px] uppercase tracking-[0.18em] text-text-quiet">
            Categorised opportunities
          </p>
          <Link
            href="/insights/drivers"
            data-testid="v7-link-driver-analytics"
          >
            <Button variant="ghost" size="sm" className="gap-1">
              Driver analytics
              <ChevronRight className="size-3.5" />
            </Button>
          </Link>
        </div>
        <InsightsBoard insights={insights} onAction={handleAction} />
      </div>
    </ScrollArea>
  );
}

export default function InsightsPage() {
  const [location] = useLocation();
  const isAnalytics =
    location.startsWith("/insights/drivers") || location.startsWith("/analytics");
  const analyticsBody = useDispatchTabBody("analytics");
  if (isAnalytics) return <>{analyticsBody}</>;
  return <InsightsView />;
}
