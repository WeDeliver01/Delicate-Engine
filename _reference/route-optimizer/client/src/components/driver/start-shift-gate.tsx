import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Play, Gauge, Fuel, Truck } from "lucide-react";
import PhotoCapture from "./photo-capture";

const FUEL_OPTIONS = ["F", "3/4", "1/2", "1/4", "E"];

interface Props {
  open: boolean;
  vehiclePlate: string;
  vehicleType: string;
  driverLat: number | null;
  driverLng: number | null;
  loading: boolean;
  onClose: () => void;
  onStart: (payload: {
    startOdometer: number;
    startFuelLevel: string;
    startClusterPhoto: string | null;
    startLat: number | null;
    startLng: number | null;
  }) => void;
}

export default function StartShiftGate({ open, vehiclePlate, vehicleType, driverLat, driverLng, loading, onClose, onStart }: Props) {
  const [odometer, setOdometer] = useState("");
  const [fuel, setFuel] = useState<string>("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const odoNum = Number(odometer);
  const odoValid = odometer !== "" && Number.isFinite(odoNum) && odoNum >= 0;
  const photoValid = photo !== null && photo.length > 0;
  const valid = odoValid && fuel !== "" && photoValid;

  function handleStart() {
    setTouched(true);
    if (!valid || !photo) return;
    if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
    onStart({
      startOdometer: odoNum,
      startFuelLevel: fuel,
      startClusterPhoto: photo,
      startLat: driverLat,
      startLng: driverLng,
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
            style={{
              background: "hsl(var(--v7-surface-raised))",
              border: "1px solid hsl(var(--v7-border-hairline))",
              maxHeight: "90vh",
            }}
            data-testid="modal-start-shift"
          >
            <div className="px-4 py-3 border-b border-hairline flex items-center gap-2">
              <div className="p-1.5 rounded-lg" style={{ background: "hsl(var(--v7-jacaranda-500) / 0.2)" }}>
                <Play className="w-4 h-4 text-jacaranda-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-text-primary">Start Shift</h2>
                <p className="text-[11px] text-text-quiet">Capture vehicle state before departure</p>
              </div>
            </div>

            <div className="px-4 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: "calc(90vh - 140px)" }}>
              <div className="rounded-lg px-3 py-2 flex items-center gap-2" style={{ background: "hsl(var(--v7-surface-overlay) / 0.5)", border: "1px solid hsl(var(--v7-border-hairline))" }}>
                <Truck className="w-4 h-4 text-jacaranda-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-secondary font-medium truncate" data-testid="text-shift-vehicle">
                    {vehiclePlate || "No plate set"}{vehicleType ? ` · ${vehicleType}` : ""}
                  </p>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-text-tertiary mb-1.5 block">
                  <Gauge className="w-3.5 h-3.5 inline mr-1" /> Odometer (km) *
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={odometer}
                  onChange={(e) => setOdometer(e.target.value)}
                  className="w-full h-12 px-4 rounded-lg bg-surface-overlay/60 border border-hairline text-text-primary text-base focus:outline-none focus:border-jacaranda-400 focus:ring-1 focus:ring-jacaranda-400"
                  placeholder="e.g. 45230"
                  data-testid="input-odometer-start"
                />
                {touched && !odoValid && <p className="text-[11px] text-red-400 mt-1">Enter a valid odometer reading.</p>}
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
                      className={`flex-1 h-11 rounded-lg text-sm font-semibold transition-colors ${fuel === opt ? "bg-jacaranda-500 text-text-primary" : "bg-surface-overlay/60 border border-hairline text-text-tertiary"}`}
                      data-testid={`button-start-fuel-${opt.replace("/", "-")}`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                {touched && fuel === "" && <p className="text-[11px] text-red-400 mt-1">Select a fuel level.</p>}
              </div>

              <PhotoCapture
                label="Cluster Photo (odometer + fuel gauge) *"
                value={photo}
                onChange={setPhoto}
                testId="input-cluster-photo-start"
              />
              {touched && !photoValid && <p className="text-[11px] text-red-400 -mt-2">Cluster photo is required.</p>}
              <p className="text-[11px] text-text-quiet -mt-2">Capture both the odometer and fuel gauge in one photo.</p>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={onClose}
                  disabled={loading}
                  className="flex-1 h-12 rounded-xl text-sm font-semibold border border-hairline text-text-tertiary disabled:opacity-50"
                  data-testid="button-start-cancel"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStart}
                  disabled={loading || !valid}
                  className="flex-1 h-12 rounded-xl bg-jacaranda-500 text-text-primary font-semibold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
                  data-testid="button-start-shift"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Play className="w-4 h-4" /> Start Shift</>}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
