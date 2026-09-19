import type { DriverStop, EtaEntry } from "@/lib/driver-api";
import { Clock, Package, Zap, Navigation, Truck, ArrowDownToLine } from "lucide-react";

interface Props {
  stops: DriverStop[];
  etaMap: Map<string, EtaEntry>;
}

function etaBadgeColor(stop: DriverStop, eta?: EtaEntry): string {
  const isLate = stop.late;
  const etaMin = eta?.etaMin ?? stop.etaM;
  if (isLate) return "bg-red-500/20 text-red-400";
  if (etaMin && stop.win) {
    const winParts = stop.win.split("-");
    if (winParts.length === 2) {
      const endParts = winParts[1].trim().split(":");
      if (endParts.length === 2) {
        const endMin = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
        if (etaMin > endMin - 15) return "bg-amber-500/20 text-amber-400";
      }
    }
  }
  return "bg-success/20 text-success";
}

export default function UpcomingStopsList({ stops, etaMap }: Props) {
  function openNav(stop: DriverStop) {
    if (stop.lat && stop.lng) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`, "_blank");
    }
  }

  return (
    <div className="space-y-2">
      {stops.map((s) => {
        const eta = etaMap.get(s.key);
        const address = s.addr || `${s.sub}, ${s.city}`;
        const etaText = eta?.eta || s.eta;
        const badgeColor = etaBadgeColor(s, eta);
        return (
          <div
            key={s.key}
            className="rounded-lg p-3 flex items-center gap-3"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
            data-testid={`card-upcoming-stop-${s.seq}`}
          >
            <div className="w-7 h-7 rounded-lg bg-surface-overlay/60 flex items-center justify-center flex-shrink-0">
              {s.type === "C" ? (
                <ArrowDownToLine className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Truck className="w-3.5 h-3.5 text-jacaranda-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-text-quiet uppercase">{s.seq}.</span>
                <p className="text-xs text-text-secondary leading-snug break-words">{address}</p>
                {s.spx && <Zap className="w-3 h-3 text-amber-400 flex-shrink-0" />}
              </div>
              {s.acc && <p className="text-[10px] text-text-quiet">{s.acc}</p>}
              <div className="flex items-center gap-2 text-xs text-text-quiet mt-0.5 flex-wrap">
                <span>{s.wbs.join(", ")}</span>
                {etaText && (
                  <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${badgeColor}`}>
                    <Clock className="w-3 h-3" /> {etaText}
                  </span>
                )}
                {(eta?.legKm ?? s.legKm) > 0 && (
                  <span className="text-[10px] text-text-quiet/70">{(eta?.legKm ?? s.legKm).toFixed(1)} km</span>
                )}
                <span className="flex items-center gap-0.5"><Package className="w-3 h-3" /> {s.pcs}</span>
                {s.win && <span className="text-[10px] text-text-quiet/70">{s.win}</span>}
              </div>
            </div>
            <button
              onClick={() => openNav(s)}
              className="p-2 text-text-quiet hover:text-[#4a9eff] flex-shrink-0"
              data-testid={`button-nav-stop-${s.seq}`}
            >
              <Navigation className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
