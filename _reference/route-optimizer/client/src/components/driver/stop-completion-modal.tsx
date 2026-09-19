import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { DriverStop } from "@/lib/driver-api";
import SignaturePad from "@/components/driver/signature-pad";
import {
  X, CheckCircle2, XCircle, User, FileText, Loader2,
} from "lucide-react";

const FAIL_REASONS = [
  "No one at address",
  "Wrong address",
  "Refused delivery",
  "Damaged parcel",
  "Gate locked / no access",
  "Other",
];

interface Props {
  open: boolean;
  stop: DriverStop | null;
  initialTab?: "complete" | "fail";
  onClose: () => void;
  onComplete: (recipientName: string, notes: string, signature?: string | null) => void;
  onFail: (notes: string) => void;
  loading: boolean;
}

export default function StopCompletionModal({ open, stop, initialTab = "complete", onClose, onComplete, onFail, loading }: Props) {
  const [tab, setTab] = useState<"complete" | "fail">(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);
  const [recipientName, setRecipientName] = useState("");
  const [notes, setNotes] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [failReason, setFailReason] = useState("");
  const [failNotes, setFailNotes] = useState("");

  function handleComplete() {
    if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
    onComplete(recipientName.trim(), notes.trim(), signature);
    setRecipientName("");
    setNotes("");
    setSignature(null);
  }

  function handleFail() {
    if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
    const reason = failReason === "Other" ? failNotes.trim() : failReason;
    onFail(reason || "Unable to deliver");
    setFailReason("");
    setFailNotes("");
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
            style={{ background: "#16213e", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh" }}
            onClick={(e) => e.stopPropagation()}
            data-testid="modal-stop-completion"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
              <h2 className="text-lg font-semibold text-text-primary truncate pr-2">
                {stop.addr || `${stop.sub}, ${stop.city}`}
              </h2>
              <button onClick={onClose} className="p-1 text-text-tertiary flex-shrink-0" data-testid="button-close-modal">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex border-b border-hairline">
              <button
                onClick={() => setTab("complete")}
                className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors ${tab === "complete" ? "border-[#22c55e] text-success" : "border-transparent text-text-quiet"}`}
                data-testid="tab-complete"
              >
                <CheckCircle2 className="w-4 h-4" /> Complete
              </button>
              <button
                onClick={() => setTab("fail")}
                className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors ${tab === "fail" ? "border-red-400 text-red-400" : "border-transparent text-text-quiet"}`}
                data-testid="tab-fail"
              >
                <XCircle className="w-4 h-4" /> Failed
              </button>
            </div>

            <div className="px-4 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: "calc(85vh - 120px)" }}>
              {tab === "complete" ? (
                <>
                  <div>
                    <label className="text-xs font-medium text-text-tertiary mb-1.5 block">
                      <User className="w-3.5 h-3.5 inline mr-1" />Recipient Name
                    </label>
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      className="w-full h-12 px-4 rounded-lg bg-surface-overlay/60 border border-hairline text-text-primary text-base focus:outline-none focus:border-[#22c55e] focus:ring-1 focus:ring-[#22c55e]"
                      placeholder="Who received the parcel?"
                      data-testid="input-recipient"
                    />
                  </div>
                  <SignaturePad onSignatureChange={setSignature} />
                  <div>
                    <label className="text-xs font-medium text-text-tertiary mb-1.5 block">
                      <FileText className="w-3.5 h-3.5 inline mr-1" />Notes (optional)
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full h-20 px-4 py-3 rounded-lg bg-surface-overlay/60 border border-hairline text-text-primary text-base resize-none focus:outline-none focus:border-[#22c55e] focus:ring-1 focus:ring-[#22c55e]"
                      placeholder="Any delivery notes..."
                      data-testid="input-notes"
                    />
                  </div>
                  <button
                    onClick={handleComplete}
                    disabled={loading}
                    className="w-full h-12 rounded-xl bg-success text-text-primary font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
                    data-testid="button-confirm-complete"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><CheckCircle2 className="w-5 h-5" /> Mark Complete</>}
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-medium text-text-tertiary mb-2 block">Select a reason</label>
                    <div className="space-y-2">
                      {FAIL_REASONS.map((reason) => (
                        <button
                          key={reason}
                          onClick={() => setFailReason(reason)}
                          className={`w-full text-left px-4 py-3 rounded-lg text-sm transition-colors ${failReason === reason ? "bg-red-500/20 border-red-500/40 text-red-300" : "bg-surface-overlay/40 border-hairline text-text-tertiary"} border`}
                          data-testid={`button-fail-reason-${reason.toLowerCase().replace(/[\s/]+/g, "-")}`}
                        >
                          {reason}
                        </button>
                      ))}
                    </div>
                  </div>
                  {failReason === "Other" && (
                    <div>
                      <label className="text-xs font-medium text-text-tertiary mb-1.5 block">
                        <FileText className="w-3.5 h-3.5 inline mr-1" />Details
                      </label>
                      <textarea
                        value={failNotes}
                        onChange={(e) => setFailNotes(e.target.value)}
                        className="w-full h-20 px-4 py-3 rounded-lg bg-surface-overlay/60 border border-hairline text-text-primary text-base resize-none focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400"
                        placeholder="Describe what happened..."
                        data-testid="input-fail-reason"
                      />
                    </div>
                  )}
                  <button
                    onClick={handleFail}
                    disabled={loading || !failReason}
                    className="w-full h-12 rounded-xl bg-red-500 text-text-primary font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
                    data-testid="button-confirm-fail"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><XCircle className="w-5 h-5" /> Mark as Failed</>}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
