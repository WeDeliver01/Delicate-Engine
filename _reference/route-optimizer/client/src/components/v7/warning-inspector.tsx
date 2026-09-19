import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useDispatchData } from "@/hooks/use-dispatch-data";
import { refreshAfterAssign } from "@/lib/refresh-after-assign";
import { useToast } from "@/hooks/use-toast";
import type { Driver, Shipment } from "@shared/schema";
import type { TripData, WarningItem } from "@/lib/routing";
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  MapPin,
  TrendingDown,
  TrendingUp,
  User,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  warning: WarningItem | null;
}

interface Recommendation {
  driver: Driver;
  reason: string;
  score: number;
  delta: number; // late minutes change estimate
  isCurrent: boolean;
}

export function extractWaybills(msg: string): string[] {
  const head = msg.split(":")[0] ?? "";
  return head
    .split(/[,/+]/)
    .map((s) => s.trim())
    .filter((s) => /^[A-Z0-9]{4,}$/i.test(s));
}

function summariseTrip(t?: TripData) {
  if (!t) return "No trip planned";
  const late = t.stats?.lateCount ?? 0;
  const peak = t.stats?.peakLoad ?? 0;
  const km = Math.round(t.stats?.totalKm ?? 0);
  const stops = t.stops?.length ?? 0;
  return `${stops} stops · ${km} km · ${late} late · peak load ${peak}`;
}

export function WarningInspector({ open, onClose, warning }: Props) {
  const { fleet, fleetSettings, dayShips, tl, asgn, setAsgn, log } = useDispatchData();
  const qc = useQueryClient();
  const { toast } = useToast();

  const wbs = useMemo(() => (warning ? extractWaybills(warning.msg) : []), [warning]);

  const shipments = useMemo<Shipment[]>(
    () => wbs.map((wb) => dayShips.find((s) => s.wb === wb)).filter((s): s is Shipment => Boolean(s)),
    [wbs, dayShips],
  );

  const primary = shipments[0];
  const currentDriverId = primary ? asgn[primary.wb] : undefined;
  const currentDriver = fleet.find((d) => d.id === currentDriverId);

  const recommendations = useMemo<Recommendation[]>(() => {
    if (!primary) return [];
    const profiles = fleetSettings.drivers || [];
    const recs: Recommendation[] = [];

    for (const d of fleet) {
      const profile = profiles.find((p: any) => p.id === d.id);
      const isActive = profile?.active !== false;
      const isCurrent = d.id === currentDriverId;
      const trip = tl[d.id];
      const stops = trip?.stops?.length ?? 0;
      const late = trip?.stats?.lateCount ?? 0;
      const peak = trip?.stats?.peakLoad ?? 0;
      const cap = (profile as any)?.capacity ?? 20;
      const utilisation = cap > 0 ? peak / cap : 1;

      if (!isActive && !isCurrent) continue;

      // Lower is better. Penalize lateness, high utilisation, and many stops.
      const score = late * 30 + utilisation * 50 + stops * 1.5;
      const reason = isCurrent
        ? `Currently assigned · ${late} late · ${Math.round(utilisation * 100)}% capacity used`
        : !isActive
          ? `Offline — turn back on first`
          : late > 0
            ? `${late} late stops · ${Math.round(utilisation * 100)}% capacity used`
            : utilisation > 0.85
              ? `${Math.round(utilisation * 100)}% capacity used — risk of overload`
              : `${stops} stops · ${Math.round(utilisation * 100)}% capacity used`;

      recs.push({
        driver: d,
        reason,
        score,
        delta: isCurrent ? 0 : late * 5 - 10,
        isCurrent,
      });
    }
    return recs.sort((a, b) => {
      if (a.isCurrent) return 1;
      if (b.isCurrent) return -1;
      return a.score - b.score;
    });
  }, [primary, fleet, fleetSettings, tl, currentDriverId]);

  function reassign(toDriverId: string) {
    if (!primary) return;
    const next = { ...asgn };
    let count = 0;
    for (const s of shipments) {
      if (next[s.wb] !== toDriverId) {
        next[s.wb] = toDriverId;
        count++;
      }
    }
    setAsgn(next);
    const toName = fleet.find((d) => d.id === toDriverId)?.name || toDriverId;
    log(`Reassigned ${count} shipment(s) ${wbs.join(", ")} to ${toName} from warning inspector`, "MANUAL");
    toast({ title: "Shipment reassigned", description: `${wbs.join(", ")} moved to ${toName}` });
    refreshAfterAssign(qc);
    onClose();
  }

  if (!warning) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl bg-surface-raised border-hairline" data-testid="warning-inspector-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-text-primary">
            <AlertTriangle className={`size-4 ${warning.sev === "HIGH" ? "text-danger" : warning.sev === "MED" ? "text-warning" : "text-text-tertiary"}`} />
            <span>{warning.sev === "HIGH" ? "Alert" : warning.sev === "MED" ? "Warning" : "Note"}</span>
            <StatusPill tone={warning.sev === "HIGH" ? "danger" : warning.sev === "MED" ? "warning" : "neutral"} size="sm">
              {warning.sev}
            </StatusPill>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-hairline bg-surface-overlay/40 p-3">
            <div className="text-[11px] uppercase tracking-wide text-text-quiet mb-1">Issue</div>
            <div className="text-sm text-text-secondary leading-relaxed">{warning.msg}</div>
          </div>

          {primary ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-md border border-hairline bg-surface-overlay/40 p-3 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide text-text-quiet">Shipment</div>
                <div className="font-mono text-sm text-text-primary">{wbs.join(", ")}</div>
                {(primary.dSub || primary.cSub) && (
                  <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <MapPin className="size-3 text-text-quiet" />
                    {primary.cSub && <span>{primary.cSub}</span>}
                    {primary.cSub && primary.dSub && <span className="text-text-quiet">→</span>}
                    {primary.dSub && <span>{primary.dSub}</span>}
                  </div>
                )}
                {(primary.delDate || primary.colDate) && (
                  <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <Clock className="size-3 text-text-quiet" />
                    {primary.colDate && <span>Col {primary.colDate}</span>}
                    {primary.delDate && <span>Del {primary.delDate}</span>}
                  </div>
                )}
              </div>
              <div className="rounded-md border border-hairline bg-surface-overlay/40 p-3 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide text-text-quiet">Currently with</div>
                <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                  <User className="size-3.5 text-text-quiet" />
                  {currentDriver?.name || "Unassigned"}
                </div>
                <div className="text-xs text-text-tertiary">
                  {summariseTrip(currentDriverId ? tl[currentDriverId] : undefined)}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-hairline bg-surface-overlay/40 p-3 text-sm text-text-tertiary">
              Couldn't link this warning to a shipment in today's plan. It may belong to a different day.
            </div>
          )}

          {primary && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-text-quiet">Recommendations</div>
              <div className="space-y-1.5">
                {recommendations.map((rec, idx) => {
                  const isBest = idx === 0 && !rec.isCurrent;
                  return (
                    <div
                      key={rec.driver.id}
                      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                        rec.isCurrent
                          ? "border-hairline bg-surface-overlay/30"
                          : isBest
                            ? "border-success/40 bg-success/5"
                            : "border-hairline bg-surface-overlay/40"
                      }`}
                      data-testid={`rec-${rec.driver.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                          {rec.driver.name}
                          {rec.isCurrent && (
                            <StatusPill tone="neutral" size="sm">Current</StatusPill>
                          )}
                          {isBest && (
                            <StatusPill tone="success" size="sm">Best fit</StatusPill>
                          )}
                          {rec.delta < 0 ? (
                            <span className="inline-flex items-center text-[11px] text-success">
                              <TrendingDown className="size-3" /> likely better
                            </span>
                          ) : rec.delta > 0 ? (
                            <span className="inline-flex items-center text-[11px] text-warning">
                              <TrendingUp className="size-3" /> may run late
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-text-tertiary truncate">{rec.reason}</div>
                      </div>
                      {rec.isCurrent ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={onClose}
                          className="gap-1.5 border-hairline text-text-secondary"
                          data-testid={`button-keep-${rec.driver.id}`}
                        >
                          <CheckCircle2 className="size-3.5" />
                          Keep
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => reassign(rec.driver.id)}
                          className={`gap-1.5 ${isBest ? "bg-jacaranda-gradient text-white border-0" : ""}`}
                          variant={isBest ? "default" : "outline"}
                          data-testid={`button-move-${rec.driver.id}`}
                        >
                          <ArrowRightLeft className="size-3.5" />
                          Move here
                        </Button>
                      )}
                    </div>
                  );
                })}
                {recommendations.length === 0 && (
                  <div className="text-xs text-text-tertiary">No active drivers available.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
