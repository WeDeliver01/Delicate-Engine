import { Fragment, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, Popup, LayersControl, LayerGroup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { MetricCard } from "@/components/ui/metric-card";
import { RefreshCw, Activity, Clock, Route as RouteIcon, Users, Loader2 } from "lucide-react";
import { useTrafficContext, type DriverRouteForMap, type DriverRouteLeg, type IncidentItem } from "@/hooks/use-dispatch-data";
import { CORRIDOR_PROBES, type CorridorTrafficResult } from "@/lib/traffic-corridors";
import { legKey } from "@/hooks/use-leg-polylines";
import { IncidentFeed } from "@/components/v7/incident-feed";
import { apiRequest } from "@/lib/queryClient";

const PRETORIA_CENTER: [number, number] = [-25.75, 28.23];

const STATUS = {
  NORMAL: { label: "NORMAL", tone: "success" as const, blurb: "All major corridors flowing freely." },
  ELEVATED: { label: "ELEVATED", tone: "warning" as const, blurb: "Slow patches reported on key arterials." },
  SEVERE: { label: "SEVERE", tone: "danger" as const, blurb: "Heavy congestion or standstills detected — detours recommended." },
};

function severityFor(worst: string, congestedRatio: number): keyof typeof STATUS {
  if (worst === "STANDSTILL" || congestedRatio > 0.4) return "SEVERE";
  if (worst === "HEAVY" || worst === "SLOW" || congestedRatio > 0.15) return "ELEVATED";
  return "NORMAL";
}

const CONGESTION_COLOR: Record<string, string> = {
  NORMAL: "#22c55e",
  SLOW: "#eab308",
  HEAVY: "#f97316",
  STANDSTILL: "#ef4444",
};

const SEVERITY_FOR_CONGESTION: Record<DriverRouteLeg["congestion"], "high" | "medium" | "low"> = {
  STANDSTILL: "high",
  HEAVY: "medium",
  SLOW: "low",
  NORMAL: "low",
};

function legToIncident(route: DriverRouteForMap, leg: DriverRouteLeg, legIndex: number): IncidentItem | null {
  if (!leg.corridorName || leg.congestion === "NORMAL") return null;
  const k = legKey(leg.fromLat, leg.fromLng, leg.toLat, leg.toLng);
  return {
    id: `leg-${route.driverId}-${legIndex}-${k}`,
    type: "incident",
    corridor: leg.corridorName,
    location: `${leg.fromLabel} → ${leg.toLabel}`,
    description: `${route.driverName} delayed +${Math.round(leg.delayMin)}min on ${leg.corridorName} (${leg.congestion})`,
    severity: SEVERITY_FOR_CONGESTION[leg.congestion],
    affectsRoute: true,
    isActiveNow: true,
  };
}

export default function TrafficPage() {
  const traffic = useTrafficContext();
  const legGeometries = traffic.legGeometries;
  const [corridorData, setCorridorData] = useState<CorridorTrafficResult[]>([]);
  const [loadingCorridors, setLoadingCorridors] = useState(false);

  async function fetchCorridors() {
    setLoadingCorridors(true);
    try {
      const legs = CORRIDOR_PROBES.flatMap((c) => [
        { originLat: c.originLat, originLng: c.originLng, destLat: c.destLat, destLng: c.destLng },
        { originLat: c.altOriginLat, originLng: c.altOriginLng, destLat: c.altDestLat, destLng: c.altDestLng },
      ]);
      const res = await apiRequest("POST", "/api/routes/traffic/batch", { legs });
      const data = await res.json();
      const results: CorridorTrafficResult[] = CORRIDOR_PROBES.map((c, i) => {
        const m = data.legs?.[i * 2];
        const a = data.legs?.[i * 2 + 1];
        return {
          corridorId: c.id,
          mainRoute: m && !m.error ? { durationMin: m.durationMin, distanceKm: m.distanceKm, congestion: m.congestionLevel || "NORMAL", delayMin: m.trafficDelayMin || 0 } : null,
          altRoute: a && !a.error ? { durationMin: a.durationMin, distanceKm: a.distanceKm, congestion: a.congestionLevel || "NORMAL", delayMin: a.trafficDelayMin || 0 } : null,
          error: (m?.error || a?.error) ? "Partial data" : undefined,
        };
      });
      setCorridorData(results);
    } catch (e) {
      console.warn("[traffic] corridor probe failed", e);
    } finally {
      setLoadingCorridors(false);
    }
  }

  useEffect(() => {
    fetchCorridors();
    const id = setInterval(fetchCorridors, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const congestedRatio = traffic.totalLegs > 0 ? traffic.congestedLegs / traffic.totalLegs : 0;
  const status = STATUS[severityFor(traffic.worstCongestion, congestedRatio)];

  const corridorPolylines = useMemo(() => {
    return CORRIDOR_PROBES.map((corridor) => {
      const data = corridorData.find((c) => c.corridorId === corridor.id);
      const congestion = data?.mainRoute?.congestion ?? "NORMAL";
      const color = CONGESTION_COLOR[congestion];
      const delay = data?.mainRoute?.delayMin ?? 0;
      const k = legKey(corridor.originLat, corridor.originLng, corridor.destLat, corridor.destLng);
      const road = legGeometries.get(k);
      const positions: [number, number][] = road && road.length > 1
        ? road.map((p) => [p[0], p[1]] as [number, number])
        : [
            [corridor.originLat, corridor.originLng],
            [corridor.destLat, corridor.destLng],
          ];
      const mid = positions[Math.floor(positions.length / 2)];
      return {
        key: corridor.id,
        positions,
        center: mid,
        color,
        name: corridor.name,
        congestion,
        delay,
        onRoad: !!road,
      };
    });
  }, [corridorData, legGeometries]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[1500px] mx-auto px-6 py-6 space-y-6">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-quiet">Live Network</p>
            <h1 className="font-display text-5xl font-medium text-text-primary tracking-tight mt-1" data-testid="text-traffic-status">
              {status.label}
            </h1>
            <p className="text-sm text-text-tertiary mt-2 max-w-xl leading-relaxed">{status.blurb}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill tone={status.tone} dot data-testid="pill-traffic-tone">
              {traffic.trafficStatus.enabled ? "Live" : "Offline"}
            </StatusPill>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { traffic.refreshTraffic(); fetchCorridors(); }}
              disabled={traffic.trafficStatus.isRefreshing || loadingCorridors}
              data-testid="button-refresh-traffic"
            >
              {traffic.trafficStatus.isRefreshing || loadingCorridors ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5 mr-1.5" />
              )}
              Refresh
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Total Delay" value={traffic.totalDelayMin} unit="min" icon={<Clock className="size-4" />} tone={traffic.totalDelayMin > 30 ? "warning" : "neutral"} data-testid="metric-total-delay" />
          <MetricCard label="Congested Legs" value={`${traffic.congestedLegs}/${traffic.totalLegs}`} icon={<RouteIcon className="size-4" />} tone={congestedRatio > 0.3 ? "warning" : "neutral"} data-testid="metric-congested-legs" />
          <MetricCard label="Affected Drivers" value={traffic.affectedDriverCount} icon={<Users className="size-4" />} data-testid="metric-affected-drivers" />
          <MetricCard label="Worst State" value={traffic.worstCongestion} icon={<Activity className="size-4" />} tone={traffic.worstCongestion === "STANDSTILL" ? "danger" : traffic.worstCongestion === "HEAVY" ? "warning" : "neutral"} data-testid="metric-worst-state" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-[560px]">
          <Card grain className="lg:col-span-2 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-hairline">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-base font-medium text-text-primary tracking-tight">Congestion Overlay</h3>
                <span className="text-[11px] uppercase tracking-[0.12em] text-text-quiet">N1 · N4 · N14 · R21</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                {(["NORMAL", "SLOW", "HEAVY", "STANDSTILL"] as const).map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5 text-text-tertiary">
                    <span className="size-2 rounded-full" style={{ background: CONGESTION_COLOR[c] }} />
                    {c}
                  </span>
                ))}
              </div>
            </div>
            {traffic.driverRoutes.length > 0 && (
              <div className="flex items-center gap-2 px-5 py-2 border-b border-hairline overflow-x-auto" data-testid="legend-driver-routes">
                <span className="text-[10px] uppercase tracking-[0.14em] text-text-quiet shrink-0">Drivers</span>
                {traffic.driverRoutes.map((r) => (
                  <span
                    key={`legend-${r.driverId}`}
                    className="inline-flex items-center gap-1.5 text-[11px] text-text-tertiary shrink-0"
                    data-testid={`legend-driver-${r.driverId}`}
                    title={`${r.driverName} · ${r.legs.length} legs · ${r.worstCongestion}${r.totalDelayMin > 0 ? ` · +${Math.round(r.totalDelayMin)}min` : ""}`}
                  >
                    <span className="inline-block w-3 h-[3px] rounded-sm" style={{ background: r.driverColor }} />
                    {r.driverName}
                    {r.worstCongestion !== "NORMAL" && (
                      <span className="inline-block size-1.5 rounded-full" style={{ background: CONGESTION_COLOR[r.worstCongestion] }} />
                    )}
                  </span>
                ))}
              </div>
            )}
            <div className="flex-1 min-h-[460px]">
              <MapContainer center={PRETORIA_CENTER} zoom={10} className="h-full w-full" style={{ background: "#0b0b10" }} data-testid="map-traffic">
                <TileLayer
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  attribution='&copy; OpenStreetMap &copy; CARTO'
                />
                <LayersControl position="topright">
                  <LayersControl.Overlay checked name="Corridor congestion">
                    <LayerGroup>
                      {corridorPolylines.map((line) => (
                        <Fragment key={line.key}>
                          {/* glow underlay */}
                          <Polyline
                            positions={line.positions}
                            pathOptions={{ color: line.color, weight: 9, opacity: 0.22 }}
                            interactive={false}
                          />
                          <Polyline
                            positions={line.positions}
                            pathOptions={{ color: line.color, weight: 5, opacity: 0.95, dashArray: line.onRoad ? undefined : "6 6", lineCap: "round", lineJoin: "round" }}
                          >
                            <Tooltip>{line.name} — {line.congestion}{line.delay > 0 ? ` (+${Math.round(line.delay)}min)` : ""}</Tooltip>
                          </Polyline>
                        </Fragment>
                      ))}
                      {corridorPolylines.map((line) => (
                        <CircleMarker
                          key={`m-${line.key}`}
                          center={line.center}
                          radius={6}
                          pathOptions={{ color: "#fff", fillColor: line.color, fillOpacity: 1, weight: 1.5 }}
                        >
                          <Tooltip permanent direction="top" offset={[0, -8]} className="!bg-surface-raised !text-text-primary !border-hairline !text-[10px]">
                            {line.name}
                          </Tooltip>
                        </CircleMarker>
                      ))}
                    </LayerGroup>
                  </LayersControl.Overlay>
                  <LayersControl.Overlay checked name={`Driver routes (${traffic.driverRoutes.length})`}>
                    <LayerGroup>
                      {traffic.driverRoutes.map((route) => (
                        <LayerGroup key={`drv-${route.driverId}`}>
                          {route.legs.map((leg, i) => {
                            const k = legKey(leg.fromLat, leg.fromLng, leg.toLat, leg.toLng);
                            const road = legGeometries.get(k);
                            const positions: [number, number][] = road && road.length > 1
                              ? road.map((p) => [p[0], p[1]] as [number, number])
                              : [[leg.fromLat, leg.fromLng], [leg.toLat, leg.toLng]];
                            const congested = leg.congestion !== "NORMAL";
                            const onRoad = !!road;
                            const incident = legToIncident(route, leg, i);
                            return (
                              <Fragment key={`leg-frag-${route.driverId}-${i}`}>
                                <Polyline
                                  positions={positions}
                                  pathOptions={{ color: route.driverColor, weight: 7, opacity: 0.30, lineCap: "round", lineJoin: "round" }}
                                  interactive={false}
                                />
                                <Polyline
                                  positions={positions}
                                  pathOptions={{
                                    color: congested ? CONGESTION_COLOR[leg.congestion] : route.driverColor,
                                    weight: congested ? 4 : 3,
                                    opacity: congested ? 0.95 : 0.9,
                                    dashArray: onRoad ? undefined : (congested ? undefined : "4 4"),
                                    lineCap: "round",
                                    lineJoin: "round",
                                  }}
                                  data-testid={`route-leg-${route.driverId}-${i}`}
                                >
                                  <Tooltip>
                                    <div className="text-[11px]">
                                      <div className="font-medium" style={{ color: route.driverColor }}>{route.driverName}</div>
                                      <div className="text-text-tertiary">{leg.fromLabel} → {leg.toLabel}</div>
                                      <div>
                                        {leg.congestion}
                                        {leg.delayMin > 0 ? ` · +${Math.round(leg.delayMin)}min delay` : ""}
                                      </div>
                                      {leg.corridorName && (
                                        <div className="text-text-tertiary" data-testid={`leg-corridor-${route.driverId}-${i}`}>
                                          On <span className="font-medium text-text-primary">{leg.corridorName}</span>
                                        </div>
                                      )}
                                      {incident && (
                                        <div className="text-text-quiet italic mt-0.5">Click for detour</div>
                                      )}
                                    </div>
                                  </Tooltip>
                                  {incident && (
                                    <Popup>
                                      <div className="text-[11px] space-y-1.5 min-w-[180px]">
                                        <div className="font-medium" style={{ color: route.driverColor }}>{route.driverName}</div>
                                        <div className="text-text-tertiary">{leg.fromLabel} → {leg.toLabel}</div>
                                        <div>
                                          On <span className="font-medium">{leg.corridorName}</span> · {leg.congestion}
                                          {leg.delayMin > 0 ? ` · +${Math.round(leg.delayMin)}min` : ""}
                                        </div>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="mt-1 h-7 w-full text-xs border-jacaranda-400/30 text-jacaranda-200 hover:bg-jacaranda-500/10"
                                          onClick={() => traffic.generateDetour(incident)}
                                          disabled={traffic.optimizing}
                                          data-testid={`button-leg-detour-${route.driverId}-${i}`}
                                        >
                                          {traffic.optimizing ? (
                                            <Loader2 className="size-3 mr-1 animate-spin" />
                                          ) : (
                                            <RouteIcon className="size-3 mr-1" />
                                          )}
                                          Generate Detour
                                        </Button>
                                      </div>
                                    </Popup>
                                  )}
                                </Polyline>
                              </Fragment>
                            );
                          })}
                          {route.stops.map((s, i) => (
                            <CircleMarker
                              key={`stop-${route.driverId}-${i}`}
                              center={[s.lat, s.lng]}
                              radius={3}
                              pathOptions={{ color: route.driverColor, fillColor: route.driverColor, fillOpacity: 0.9, weight: 1 }}
                              data-testid={`route-stop-${route.driverId}-${i}`}
                            >
                              <Tooltip>
                                <div className="text-[11px]">
                                  <span className="font-medium" style={{ color: route.driverColor }}>{route.driverName}</span> · stop {i + 1}
                                  <div className="text-text-tertiary">{s.label}</div>
                                </div>
                              </Tooltip>
                            </CircleMarker>
                          ))}
                        </LayerGroup>
                      ))}
                    </LayerGroup>
                  </LayersControl.Overlay>
                </LayersControl>
              </MapContainer>
            </div>
          </Card>

          <IncidentFeed />
        </div>
      </div>
    </div>
  );
}
