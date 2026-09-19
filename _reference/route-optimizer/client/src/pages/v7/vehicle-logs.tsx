import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, AlertTriangle, Camera, Fuel, MapPin, Loader2, X } from "lucide-react";

interface TripRow {
  id: number;
  driverAccountId: number;
  driverName: string;
  vehiclePlate: string | null;
  vehicleType: string | null;
  projectId: string | null;
  startTime: string;
  endTime: string | null;
  startOdometer: number;
  endOdometer: number | null;
  startFuelLevel: string | null;
  endFuelLevel: string | null;
  status: string;
  notes: string | null;
  stopCount: number;
  fuelTotal: number;
  litresTotal: number;
  distanceKm: number | null;
  startOdometerOcr: number | null;
  endOdometerOcr: number | null;
  hasStartPhoto: boolean;
  hasEndPhoto: boolean;
  startMismatch: boolean;
  endMismatch: boolean;
  fuelExpenseCount: number;
  fuelMissingReceipts: number;
  ocrProcessedAt: string | null;
  ocrError: string | null;
  verified: boolean;
}

interface TripDetail {
  trip: TripRow & {
    startClusterPhoto?: string | null;
    endClusterPhoto?: string | null;
    ocrRawText?: string | null;
  };
  driver: { id: number; driverName: string; phone: string | null } | null;
  stops: Array<{
    id: number;
    stopKey: string;
    waybill: string | null;
    stopType: string;
    photoUrl: string | null;
    notes: string;
    arrivedAt: string;
    lat: number | null;
    lng: number | null;
  }>;
  expenses: Array<{
    id: number;
    expenseType: string;
    amount: number;
    litres: number | null;
    receiptUrl: string | null;
    ocrAmount: number | null;
    ocrLitres: number | null;
    ocrStation: string | null;
    ocrDate: string | null;
    ocrText: string | null;
    ocrError: string | null;
    ocrProcessedAt: string | null;
    hasReceipt: boolean;
    amountMismatch: boolean;
    litresMismatch: boolean;
    notes: string;
    incurredAt: string;
  }>;
  verification: {
    hasStartPhoto: boolean;
    hasEndPhoto: boolean;
    startMismatch: boolean;
    endMismatch: boolean;
    fuelMissingReceipts: number;
    verified: boolean;
  };
  summary: {
    stopCount: number;
    distanceKm: number | null;
    fuelTotal: number;
    litresTotal: number;
  };
}

function fmtKm(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)} km`;
}
function fmtZar(n: number | null | undefined): string {
  if (n == null) return "—";
  return `R ${n.toFixed(2)}`;
}
function fmtL(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(2)} L`;
}
function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function VehicleLogsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [verifiedFilter, setVerifiedFilter] = useState<string>("all");
  const [openTripId, setOpenTripId] = useState<number | null>(null);

  const tripsQuery = useQuery<{ trips: TripRow[] }>({
    queryKey: ["/api/vehicle-logs/trips", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", "200");
      const res = await fetch(`/api/vehicle-logs/trips?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load trips");
      return res.json();
    },
  });

  const trips = tripsQuery.data?.trips || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trips.filter((t) => {
      if (verifiedFilter === "verified" && !t.verified) return false;
      if (verifiedFilter === "unverified" && t.verified) return false;
      if (q && !`${t.driverName} ${t.vehiclePlate || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [trips, search, verifiedFilter]);

  const stats = useMemo(() => {
    const closed = trips.filter((t) => t.status === "closed");
    const verified = closed.filter((t) => t.verified).length;
    const totalKm = closed.reduce((s, t) => s + (t.distanceKm || 0), 0);
    const totalFuel = closed.reduce((s, t) => s + (t.fuelTotal || 0), 0);
    const totalLitres = closed.reduce((s, t) => s + (t.litresTotal || 0), 0);
    return {
      total: closed.length,
      verified,
      pctVerified: closed.length ? Math.round((verified / closed.length) * 100) : 0,
      totalKm,
      totalFuel,
      totalLitres,
      cpk: totalKm > 0 ? totalFuel / totalKm : null,
    };
  }, [trips]);

  return (
    <div className="flex flex-col gap-4 p-6" data-testid="page-vehicle-logs">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vehicle Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Driver shift logs with photo verification and OCR.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Input
            placeholder="Search driver or plate…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
            data-testid="input-vehicle-logs-search"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36" data-testid="select-vehicle-logs-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={verifiedFilter} onValueChange={setVerifiedFilter}>
            <SelectTrigger className="w-40" data-testid="select-vehicle-logs-verified">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All shifts</SelectItem>
              <SelectItem value="verified">Verified only</SelectItem>
              <SelectItem value="unverified">Unverified only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Closed shifts</div>
          <div className="text-2xl font-semibold mt-1" data-testid="stat-closed-shifts">{stats.total}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Photo-verified</div>
          <div className="text-2xl font-semibold mt-1" data-testid="stat-verified-pct">
            {stats.verified} / {stats.total} <span className="text-sm text-muted-foreground">({stats.pctVerified}%)</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Total distance</div>
          <div className="text-2xl font-semibold mt-1" data-testid="stat-total-km">{fmtKm(stats.totalKm)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Fuel cost / km</div>
          <div className="text-2xl font-semibold mt-1" data-testid="stat-cpk">
            {stats.cpk == null ? "—" : `R ${stats.cpk.toFixed(2)}`}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        {tripsQuery.isLoading ? (
          <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No shifts found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">Driver</th>
                  <th className="text-left px-4 py-3">Vehicle</th>
                  <th className="text-left px-4 py-3">Start</th>
                  <th className="text-left px-4 py-3">End</th>
                  <th className="text-right px-4 py-3">Distance</th>
                  <th className="text-right px-4 py-3">Stops</th>
                  <th className="text-right px-4 py-3">Fuel</th>
                  <th className="text-center px-4 py-3">Verified</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    className="border-t border-border hover:bg-accent/30 cursor-pointer"
                    onClick={() => setOpenTripId(t.id)}
                    data-testid={`row-vehicle-log-${t.id}`}
                  >
                    <td className="px-4 py-3 font-medium">{t.driverName}</td>
                    <td className="px-4 py-3">
                      <div>{t.vehiclePlate || "—"}</div>
                      <div className="text-xs text-muted-foreground">{t.vehicleType || ""}</div>
                    </td>
                    <td className="px-4 py-3">{fmtDate(t.startTime)}</td>
                    <td className="px-4 py-3">{fmtDate(t.endTime)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtKm(t.distanceKm)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{t.stopCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtZar(t.fuelTotal)}</td>
                    <td className="px-4 py-3 text-center">
                      {t.status !== "closed" ? (
                        <Badge variant="outline" className="text-xs">Active</Badge>
                      ) : t.verified ? (
                        <Badge variant="default" className="bg-emerald-600/20 text-emerald-400 border-emerald-600/30 gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Verified
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-500 border-amber-600/40 gap-1">
                          <AlertTriangle className="h-3 w-3" /> Unverified
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" data-testid={`button-open-trip-${t.id}`}>Details</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <TripDetailDialog tripId={openTripId} onClose={() => setOpenTripId(null)} />
    </div>
  );
}

function TripDetailDialog({ tripId, onClose }: { tripId: number | null; onClose: () => void }) {
  const detailQuery = useQuery<TripDetail>({
    queryKey: ["/api/vehicle-logs/trips", tripId],
    enabled: tripId != null,
    queryFn: async () => {
      const res = await fetch(`/api/vehicle-logs/trips/${tripId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load trip");
      return res.json();
    },
  });

  const d = detailQuery.data;
  return (
    <Dialog open={tripId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="dialog-trip-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Shift detail
            {d?.verification?.verified ? (
              <Badge className="bg-emerald-600/20 text-emerald-400 border-emerald-600/30 gap-1">
                <CheckCircle2 className="h-3 w-3" /> Verified
              </Badge>
            ) : d ? (
              <Badge variant="outline" className="text-amber-500 border-amber-600/40 gap-1">
                <AlertTriangle className="h-3 w-3" /> Unverified
              </Badge>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {detailQuery.isLoading || !d ? (
          <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Field label="Driver" value={d.driver?.driverName || `#${d.trip.driverAccountId}`} />
              <Field label="Vehicle" value={`${d.trip.vehiclePlate || "—"} ${d.trip.vehicleType || ""}`.trim()} />
              <Field label="Start" value={fmtDate(d.trip.startTime)} />
              <Field label="End" value={fmtDate(d.trip.endTime)} />
              <Field label="Start odo (manual)" value={`${d.trip.startOdometer.toFixed(0)} km`} />
              <Field
                label="Start odo (OCR)"
                value={d.trip.startOdometerOcr != null ? `${d.trip.startOdometerOcr.toFixed(0)} km` : "—"}
                warn={d.verification.startMismatch}
              />
              <Field label="End odo (manual)" value={d.trip.endOdometer != null ? `${d.trip.endOdometer.toFixed(0)} km` : "—"} />
              <Field
                label="End odo (OCR)"
                value={d.trip.endOdometerOcr != null ? `${d.trip.endOdometerOcr.toFixed(0)} km` : "—"}
                warn={d.verification.endMismatch}
              />
              <Field label="Distance" value={fmtKm(d.summary.distanceKm)} />
              <Field label="Stops" value={String(d.summary.stopCount)} />
              <Field label="Fuel" value={fmtZar(d.summary.fuelTotal)} />
              <Field label="Litres" value={fmtL(d.summary.litresTotal)} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <PhotoCard
                label="Start cluster"
                src={d.trip.startClusterPhoto}
                missing={!d.verification.hasStartPhoto}
              />
              <PhotoCard
                label="End cluster"
                src={d.trip.endClusterPhoto}
                missing={!d.verification.hasEndPhoto && d.trip.status === "closed"}
              />
            </div>

            {d.trip.ocrError ? (
              <Card className="p-3 border-red-600/40 bg-red-600/5 text-sm text-red-400 flex gap-2 items-start">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">Cluster OCR failed</div>
                  <div className="text-xs opacity-80">{d.trip.ocrError}</div>
                </div>
              </Card>
            ) : null}

            <div>
              <div className="text-sm font-medium mb-2 flex items-center gap-2">
                <Fuel className="h-4 w-4" /> Expenses ({d.expenses.length})
              </div>
              {d.expenses.length === 0 ? (
                <div className="text-xs text-muted-foreground">No expenses logged.</div>
              ) : (
                <div className="space-y-2">
                  {d.expenses.map((e) => (
                    <Card key={e.id} className="p-3" data-testid={`card-expense-${e.id}`}>
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium capitalize flex items-center gap-2">
                            {e.expenseType}
                            <span className="text-xs text-muted-foreground">{fmtDate(e.incurredAt)}</span>
                            {e.expenseType === "fuel" && !e.hasReceipt ? (
                              <Badge variant="outline" className="text-amber-500 text-xs">No receipt</Badge>
                            ) : null}
                            {e.amountMismatch ? (
                              <Badge variant="outline" className="text-red-400 text-xs">Amount mismatch</Badge>
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 md:grid-cols-4 gap-1">
                            <span>Manual: <strong className="text-foreground">{fmtZar(e.amount)}</strong></span>
                            <span>OCR: <strong className={e.amountMismatch ? "text-red-400" : "text-foreground"}>{fmtZar(e.ocrAmount)}</strong></span>
                            <span>Litres: <strong className="text-foreground">{fmtL(e.litres)}</strong></span>
                            <span>OCR L: <strong className={e.litresMismatch ? "text-red-400" : "text-foreground"}>{fmtL(e.ocrLitres)}</strong></span>
                          </div>
                          {e.ocrStation || e.ocrDate ? (
                            <div className="text-xs text-muted-foreground mt-1">
                              {e.ocrStation ? <span>Station: {e.ocrStation}</span> : null}
                              {e.ocrStation && e.ocrDate ? " · " : ""}
                              {e.ocrDate ? <span>Date: {e.ocrDate}</span> : null}
                            </div>
                          ) : null}
                          {e.ocrError ? (
                            <div className="text-xs text-red-400 mt-1">OCR error: {e.ocrError}</div>
                          ) : null}
                        </div>
                        {e.receiptUrl ? (
                          <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="shrink-0">
                            <img src={e.receiptUrl} alt="receipt" className="h-16 w-16 object-cover rounded border border-border" />
                          </a>
                        ) : (
                          <div className="shrink-0 h-16 w-16 grid place-items-center rounded border border-dashed border-border text-muted-foreground">
                            <X className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-sm font-medium mb-2 flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Stops ({d.stops.length})
              </div>
              {d.stops.length === 0 ? (
                <div className="text-xs text-muted-foreground">No stops logged.</div>
              ) : (
                <div className="space-y-1">
                  {d.stops.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 text-sm py-2 border-b border-border/60 last:border-0">
                      <Camera className="h-3 w-3 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">
                          <span className="font-mono text-xs text-muted-foreground">{s.stopKey}</span>
                          {s.waybill ? <span className="ml-2 text-xs">{s.waybill}</span> : null}
                        </div>
                        <div className="text-xs text-muted-foreground">{s.stopType} · {fmtDate(s.arrivedAt)}</div>
                      </div>
                      {s.photoUrl ? (
                        <a href={s.photoUrl} target="_blank" rel="noreferrer">
                          <img src={s.photoUrl} alt="" className="h-12 w-12 rounded object-cover border border-border" />
                        </a>
                      ) : (
                        <span className="text-xs text-amber-500">no photo</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium mt-0.5 ${warn ? "text-amber-500" : ""}`}>{value}</div>
    </div>
  );
}

function PhotoCard({ label, src, missing }: { label: string; src: string | null | undefined; missing: boolean }) {
  return (
    <Card className={`p-3 ${missing ? "border-amber-600/40 bg-amber-600/5" : ""}`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{label}</div>
      {src ? (
        <a href={src} target="_blank" rel="noreferrer">
          <img src={src} alt={label} className="w-full max-h-64 object-contain rounded bg-black/40" />
        </a>
      ) : (
        <div className="h-32 grid place-items-center text-amber-500 text-sm">
          <div className="flex flex-col items-center gap-1">
            <AlertTriangle className="h-5 w-5" />
            Missing photo
          </div>
        </div>
      )}
    </Card>
  );
}
