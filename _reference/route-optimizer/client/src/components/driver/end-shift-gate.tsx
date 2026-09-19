import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, StopCircle, Gauge, Fuel } from "lucide-react";
import PhotoCapture from "./photo-capture";

const FUEL_OPTIONS = ["F", "3/4", "1/2", "1/4", "E"];

interface Props {
  open: boolean;
  startOdometer: number;
  driverLat: number | null;
  driverLng: number | null;
  loading: boolean;
  onClose: () => void;
  onEnd: (payload: {
    endOdometer: number;
    endFuelLevel: string;
    endClusterPhoto: string | null;
    endLat: number | null;
    endLng: number | null;
    notes: string;
  }) => void;
}

export default function EndShiftGate({ open, startOdometer, driverLat, driverLng, loading, onClose, onEnd }: Props) {
  const [odometer, setOdometer] = useState("");
  const [fuel, setFuel] = useState<string>("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState(false);

  const odoNum = Number(odometer);
  const odoValid = odometer !== "" && Number.isFinite(odoNum) && odoNum >= startOdometer;
  const photoValid = photo !== null && photo.length > 0;
  const valid = odoValid && fuel !== "" && photoValid;
  const distance = odoValid ? (odoNum - startOdometer) : 0;

  function handleEnd() {
    setTouched(true);
    if (!valid || !photo) return;
    if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
    onEnd({
      endOdometer: odoNum,
      endFuelLevel: fuel,
      endClusterPhoto: photo,
      endLat: driverLat,
      endLng: driverLng,
      notes: notes.trim(),
    });
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1100] flex items-center justify-center p-3"
          style={{ background: "rgba(0,0,0,0.7)" }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="w-full max-w-lg rounded-2xl overflow-hidden"
            style={{ background: "hsl(var(--v7-surface-raised))", border: "1px solid hsl(var(--v7-border-hairline))", maxHeight: "90vh" }}
            data-testid="modal-end-shift"
          >
            <div className="px-4 py-3 border-b border-hairline flex items-center gap-2">
              <div className="p-1.5 rounded-lg" style={{ background: "hsl(var(--v7-danger) / 0.2)" }}>
                <StopCircle className="w-4 h-4 text-red-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-text-primary">End Shift</h2>
                <p className="text-[11px] text-text-quiet">Capture closing odometer & fuel</p>
              </div>
            </div>

            <div className="px-4 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: "calc(90vh - 140px)" }}>
              <div className="rounded-lg px-3 py-2 flex items-center justify-between" style={{ background: "hsl(var(--v7-surface-overlay) / 0.5)", border: "1px solid hsl(var(--v7-border-hairline))" }}>
                <span className="text-xs text-text-quiet">Start odometer</span>
                <span className="text-sm font-mono font-semibold text-text-primary tabular-nums" data-testid="text-end-start-odo">
                  {startOdometer.toLocaleString()} km
                </span>
              </div>

              <div>
                <label className="text-xs font-medium text-text-tertiary mb-1.5 block">
                  <Gauge className="w-3.5 h-3.5 inline mr-1" /> End Odometer (km) *
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={odometer}
                  onChange={(e) => setOdometer(e.target.value)}
                  className="w-full h-12 px-4 rounded-lg bg-surface-overlay/60 border border-hairline text-text-primary text-base focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400"
                  placeholder={`≥ ${startOdometer}`}
                  data-testid="input-odometer-end"
                />
                {touched && !odoValid && <p className="text-[11px] text-red-400 mt-1">End must be greater than or equal to start odometer.</p>}
                {odoValid && (
                  <p className="text-[11px] text-text-quiet mt-1" data-testid="text-end-distance">
                    Distance this shift: <span className="text-jacaranda-400 font-semibold">{distance.toLocaleString()} km</span>
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-text-tertiary mb-1.5 block">
                  <Fuel className="w-3.5 h-3.5 inline mr-1" /> Fuel Level *
                </label>
                <div className="flex gap-1.5">
                  {FUEL_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setFuel(opt)}
                      className={`flex-1 h-11 rounded-lg text-sm font-semibold transition-colors ${fuel === opt ? "bg-red-500 text-text-primary" : "bg-surface-overlay/60 border border-hairline text-text-tertiary"}`}
                      data-testid={`button-end-fuel-${opt.replace("/", "-")}`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                {touched && fuel === "" && <p className="text-[11px] text-red-400 mt-1">Select a fuel level.</p>}
              </div>

              <PhotoCapture
                label="Closing Cluster Photo *"
                value={photo}
                onChange={setPhoto}
                testId="input-cluster-photo-end"
              />
              {touched && !photoValid && <p className="text-[11px] text-red-400 -mt-2">Closing cluster photo is required.</p>}

              <div>
                <label className="text-xs font-medium text-text-tertiary mb-1.5 block">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full h-16 px-3 py-2 rounded-lg bg-surface-overlay/60 border border-hairline text-text-primary text-sm resize-none focus:outline-none focus:border-red-400"
                  placeholder="Anything dispatch should know?"
                  data-testid="input-end-notes"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={onClose}
                  disabled={loading}
                  className="flex-1 h-12 rounded-xl text-sm font-semibold border border-hairline text-text-tertiary disabled:opacity-50"
                  data-testid="button-end-cancel"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEnd}
                  disabled={loading || !valid}
                  className="flex-1 h-12 rounded-xl bg-red-500 text-text-primary font-semibold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
                  data-testid="button-end-shift"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><StopCircle className="w-4 h-4" /> End Shift</>}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
