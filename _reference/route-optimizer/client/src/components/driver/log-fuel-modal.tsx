import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Fuel, X, Receipt } from "lucide-react";
import PhotoCapture from "./photo-capture";

interface Props {
  open: boolean;
  driverLat: number | null;
  driverLng: number | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    amount: number;
    litres: number | null;
    receiptUrl: string | null;
    notes: string;
    lat: number | null;
    lng: number | null;
  }) => void;
}

export default function LogFuelModal({ open, driverLat, driverLng, loading, onClose, onSubmit }: Props) {
  const [amount, setAmount] = useState("");
  const [litres, setLitres] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState(false);

  const amountNum = Number(amount);
  const litresNum = litres === "" ? null : Number(litres);
  const amountValid = amount !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const litresValid = litres === "" || (Number.isFinite(litresNum!) && litresNum! >= 0);
  const receiptValid = receipt !== null && receipt.length > 0;

  function handleSubmit() {
    setTouched(true);
    if (!amountValid || !litresValid || !receiptValid || !receipt) return;
    if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
    onSubmit({
      amount: amountNum,
      litres: litresNum,
      receiptUrl: receipt,
      notes: notes.trim(),
      lat: driverLat,
      lng: driverLng,
    });
    setAmount("");
    setLitres("");
    setReceipt(null);
    setNotes("");
    setTouched(false);
  }

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
            data-testid="modal-log-fuel"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg" style={{ background: "hsl(var(--v7-jacaranda-500) / 0.2)" }}>
                  <Fuel className="w-4 h-4 text-jacaranda-400" />
                </div>
                <h2 className="text-base font-semibold text-text-primary">Log Fuel</h2>
              </div>
              <button onClick={onClose} className="p-1 text-text-tertiary" data-testid="button-fuel-close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-4 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: "calc(90vh - 140px)" }}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-text-tertiary mb-1.5 block">Amount (R) *</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full h-12 px-3 rounded-lg bg-surface-overlay/60 border border-hairline text-text-primary text-base focus:outline-none focus:border-jacaranda-400"
                    placeholder="0.00"
                    data-testid="input-fuel-amount"
                  />
                  {touched && !amountValid && <p className="text-[11px] text-red-400 mt-1">Amount required</p>}
                </div>
                <div>
                  <label className="text-xs font-medium text-text-tertiary mb-1.5 block">Litres</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={litres}
                    onChange={(e) => setLitres(e.target.value)}
                    className="w-full h-12 px-3 rounded-lg bg-surface-overlay/60 border border-hairline text-text-primary text-base focus:outline-none focus:border-jacaranda-400"
                    placeholder="0.00"
                    data-testid="input-fuel-litres"
                  />
                </div>
              </div>

              <PhotoCapture
                label="Receipt Photo *"
                value={receipt}
                onChange={setReceipt}
                testId="input-receipt-photo-fuel"
              />
              {touched && !receiptValid && <p className="text-[11px] text-red-400 -mt-2">Receipt photo is required.</p>}
              <p className="text-[11px] text-text-quiet -mt-2">
                <Receipt className="w-3 h-3 inline mr-1" />
                Used for OCR &amp; expense validation.
              </p>

              <div>
                <label className="text-xs font-medium text-text-tertiary mb-1.5 block">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full h-16 px-3 py-2 rounded-lg bg-surface-overlay/60 border border-hairline text-text-primary text-sm resize-none focus:outline-none focus:border-jacaranda-400"
                  placeholder="Station, pump, etc."
                  data-testid="input-fuel-notes"
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full h-12 rounded-xl bg-jacaranda-500 text-text-primary font-semibold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
                data-testid="button-fuel-save"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Fuel className="w-4 h-4" /> Save Fuel</>}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
