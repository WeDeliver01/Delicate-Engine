import { motion } from "framer-motion";
import type { DriverStop, EtaEntry } from "@/lib/driver-api";
import {
  MapPin, Clock, Package, Phone, Navigation,
  CheckCircle2, XCircle, SkipForward, Loader2, Zap, FileText,
} from "lucide-react";

function haptic(pattern: number | number[] = 30) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

interface Props {
  stop: DriverStop;
  eta?: EtaEntry;
  actionLoading: boolean;
  onArrive: () => void;
  onComplete: () => void;
  onFail: () => void;
  onSkip: () => void;
}

export default function ActiveStopCard({ stop, eta, actionLoading, onArrive, onComplete, onFail, onSkip }: Props) {
  const arrived = stop.status === "arrived";
  const address = stop.addr || `${stop.sub}, ${stop.city}`;
  const etaText = eta?.eta || stop.eta;
  const distKm = eta?.legKm ?? stop.legKm;

  function openNav() {
    if (stop.lat && stop.lng) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`, "_blank");
    }
  }

  function handleArrive() {
    haptic(40);
    onArrive();
  }

  function handleComplete() {
    haptic([30, 20, 30]);
    onComplete();
  }

  function handleFail() {
    haptic([50, 30, 50]);
    onFail();
  }

  function handleSkip() {
    haptic(25);
    onSkip();
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-3 my-2 rounded-xl overflow-hidden"
      style={{ background: "linear-gradient(135deg, rgba(74,158,255,0.15), rgba(34,197,94,0.05))", border: "1px solid rgba(74,158,255,0.3)" }}
      data-testid="card-active-stop"
    >
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-jacaranda-500/20 flex items-center justify-center text-sm font-bold text-jacaranda-400">
              {stop.seq}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-jacaranda-400 uppercase">
                  {stop.type === "C" ? "Collection" : "Delivery"}
                </span>
                {stop.spx && <Zap className="w-3 h-3 text-amber-400" />}
              </div>
              <p className="text-sm font-semibold text-text-primary leading-snug break-words" data-testid="text-active-address">{address}</p>
            </div>
          </div>
          <button
            onClick={openNav}
            className="p-2 rounded-lg bg-jacaranda-500/20 text-jacaranda-400 active:scale-95"
            data-testid="button-navigate"
          >
            <Navigation className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap text-xs text-text-tertiary mb-2">
          {etaText && (
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${stop.late ? "bg-red-500/20 text-red-400" : "bg-success/20 text-success"}`}>
              <Clock className="w-3.5 h-3.5" /> ETA {etaText}
            </span>
          )}
          <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {distKm.toFixed(1)} km</span>
          <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5" /> {stop.pcs} pcs · {stop.kg} kg</span>
        </div>

        {stop.acc && (
          <div className="text-xs text-text-tertiary mb-2" data-testid="text-client-name">
            <span className="text-text-quiet">Client:</span> {stop.acc}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-text-tertiary mb-3">
          <span className="px-2 py-0.5 rounded bg-surface-overlay/40">{stop.wbs.join(", ")}</span>
          {stop.win && <span className="px-2 py-0.5 rounded bg-surface-overlay/40">{stop.win}</span>}
        </div>

        {(stop.contact || stop.phone) && (
          <div className="flex items-center gap-3 text-xs text-text-tertiary mb-3">
            {stop.contact && <span>{stop.contact}</span>}
            {stop.phone && (
              <a href={`tel:${stop.phone}`} className="flex items-center gap-1 text-jacaranda-400" data-testid="link-call-contact">
                <Phone className="w-3 h-3" /> {stop.phone}
              </a>
            )}
          </div>
        )}

        {stop.instr && (
          <div className="flex items-start gap-1.5 text-xs text-amber-300/80 bg-amber-500/10 rounded-lg px-3 py-2 mb-3">
            <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{stop.instr}</span>
          </div>
        )}
      </div>

      <div className="px-4 pb-4 flex gap-2">
        {!arrived ? (
          <button
            onClick={handleArrive}
            disabled={actionLoading}
            className="flex-1 h-12 rounded-xl bg-jacaranda-500 text-text-primary font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
            data-testid="button-arrive"
          >
            {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><MapPin className="w-5 h-5" /> I've Arrived</>}
          </button>
        ) : (
          <>
            <button
              onClick={handleComplete}
              disabled={actionLoading}
              className="flex-1 h-12 rounded-xl bg-success text-text-primary font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
              data-testid="button-complete"
            >
              {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><CheckCircle2 className="w-5 h-5" /> Complete</>}
            </button>
            <button
              onClick={handleFail}
              disabled={actionLoading}
              className="h-12 w-12 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center active:scale-[0.98] disabled:opacity-50"
              data-testid="button-fail"
            >
              <XCircle className="w-5 h-5" />
            </button>
            <button
              onClick={handleSkip}
              disabled={actionLoading}
              className="h-12 w-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center active:scale-[0.98] disabled:opacity-50"
              data-testid="button-skip"
            >
              <SkipForward className="w-5 h-5" />
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}
