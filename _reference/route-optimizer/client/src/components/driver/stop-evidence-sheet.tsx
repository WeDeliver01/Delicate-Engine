import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, MapPin, X, FileText } from "lucide-react";
import PhotoCapture from "./photo-capture";
import type { DriverStop } from "@/lib/driver-api";

interface Props {
  open: boolean;
  stop: DriverStop | null;
  driverLat: number | null;
  driverLng: number | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (payload: { photoUrl: string | null; notes: string; lat: number | null; lng: number | null }) => void;
  onSkip: () => void;
}

export default function StopEvidenceSheet({ open, stop, driverLat, driverLng, loading, onClose, onSubmit, onSkip }: Props) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setPhoto(null);
      setNotes("");
    }
  }, [open, stop?.key]);

  function handleSubmit() {
    if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
    onSubmit({ photoUrl: photo, notes: notes.trim(), lat: driverLat, lng: driverLng });
  }

  if (!stop) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1100] flex items-center justify-center p-3"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="w-full max-w-lg rounded-2xl overflow-hidden"
            style={{ background: "hsl(var(--v7-surface-raised))", border: "1px solid hsl(var(--v7-border-hairline))", maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
            data-testid="modal-stop-evidence"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="w-4 h-4 text-jacaranda-400 flex-shrink-0" />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-text-primary truncate">Arrived — Log Evidence</h2>
                  <p className="text-[11px] text-text-quiet truncate">{stop.addr || `${stop.sub}, ${stop.city}`}</p>
                </div>
              </div>
              <button onClick={onClose} className="p-1 text-text-tertiary" data-testid="button-evidence-close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-4 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: "calc(90vh - 140px)" }}>
              <PhotoCapture
                label="Stop Photo (proof of arrival)"
                value={photo}
                onChange={setPhoto}
                testId="photo-stop-evidence"
              />

              <div>
                <label className="text-xs font-medium text-text-tertiary mb-1.5 block">
                  <FileText className="w-3.5 h-3.5 inline mr-1" /> Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full h-20 px-3 py-2 rounded-lg bg-surface-overlay/60 border border-hairline text-text-primary text-sm resize-none focus:outline-none focus:border-jacaranda-400"
                  placeholder="Any notes about this stop..."
                  data-testid="input-evidence-notes"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={onSkip}
                  disabled={loading}
                  className="flex-1 h-11 rounded-xl text-xs font-semibold border border-hairline text-text-tertiary disabled:opacity-50"
                  data-testid="button-evidence-skip"
                >
                  Skip evidence
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 h-11 rounded-xl bg-jacaranda-500 text-text-primary font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
                  data-testid="button-evidence-save"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save evidence"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
