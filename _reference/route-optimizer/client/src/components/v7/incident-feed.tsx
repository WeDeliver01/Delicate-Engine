import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertTriangle, Construction, OctagonX, Route, Loader2 } from "lucide-react";
import { useTrafficContext, type IncidentItem } from "@/hooks/use-dispatch-data";

const TYPE_ICON = {
  closure: OctagonX,
  construction: Construction,
  incident: AlertTriangle,
} as const;

const SEVERITY_TONE: Record<IncidentItem["severity"], "danger" | "warning" | "info"> = {
  high: "danger",
  medium: "warning",
  low: "info",
};

export function IncidentFeed() {
  const { incidents, generateDetour, optimizing, userReports } = useTrafficContext();
  const active = incidents.filter((i) => i.isActiveNow);

  return (
    <Card grain className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-3 border-b border-hairline">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-base font-medium text-text-primary tracking-tight">Incident Feed</h3>
          <StatusPill tone="info" size="sm">{active.length} active</StatusPill>
        </div>
        {userReports.length > 0 && (
          <StatusPill tone="brand" size="sm" dot>{userReports.length} user report{userReports.length === 1 ? "" : "s"}</StatusPill>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
        {active.length === 0 ? (
          <EmptyState
            icon={<Route className="size-5" />}
            title="No active incidents"
            description="All major Pretoria corridors are clear right now."
            className="border-0 bg-transparent py-8"
          />
        ) : (
          active.map((inc) => {
            const Icon = TYPE_ICON[inc.type];
            return (
              <div
                key={inc.id}
                className={`rounded-[var(--v7-radius-md)] border p-3 transition-all ${
                  inc.affectsRoute
                    ? "border-warning/40 bg-warning/5"
                    : "border-hairline bg-surface-base/40"
                }`}
                data-testid={`incident-${inc.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 ${inc.affectsRoute ? "text-warning" : "text-text-tertiary"}`}>
                    <Icon className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-text-primary">{inc.corridor}</span>
                      <StatusPill tone={SEVERITY_TONE[inc.severity]} size="sm">{inc.severity}</StatusPill>
                      {inc.affectsRoute && <StatusPill tone="warning" size="sm" dot>On route</StatusPill>}
                    </div>
                    <div className="text-[11px] text-text-tertiary mt-0.5">{inc.location}</div>
                    <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">{inc.description}</p>
                    {inc.detour && (
                      <p className="text-[11px] text-text-tertiary mt-1 italic">Detour: {inc.detour}</p>
                    )}
                    {inc.timeRestriction && (
                      <p className="text-[10px] uppercase tracking-[0.12em] text-text-quiet mt-1">{inc.timeRestriction}</p>
                    )}
                    {inc.affectsRoute && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-xs border-jacaranda-400/30 text-jacaranda-200 hover:bg-jacaranda-500/10"
                        onClick={() => generateDetour(inc)}
                        disabled={optimizing}
                        data-testid={`button-detour-${inc.id}`}
                      >
                        {optimizing ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Route className="size-3 mr-1" />}
                        Generate Detour
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
