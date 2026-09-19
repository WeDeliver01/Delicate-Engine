import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { X, GripVertical, Send, Loader2, ArrowUpDown } from "lucide-react";
import type { DriverStop } from "@/lib/driver-api";

interface ReorderModalProps {
  open: boolean;
  stops: DriverStop[];
  onClose: () => void;
  onSubmit: (proposedOrder: string[], reason: string) => void;
  loading: boolean;
}

export default function ReorderModal({ open, stops, onClose, onSubmit, loading }: ReorderModalProps) {
  const [items, setItems] = useState<DriverStop[]>([]);
  const [reason, setReason] = useState("");
  const prevOpen = useRef(false);

  useEffect(() => {
    if (open && !prevOpen.current && stops.length > 0) {
      setItems([...stops]);
      setReason("");
    }
    prevOpen.current = open;
  }, [open, stops]);

  function handleSubmit() {
    const proposedOrder = items.map((s) => s.key);
    onSubmit(proposedOrder, reason);
  }

  function handleClose() {
    setItems([]);
    setReason("");
    onClose();
  }

  const hasChanges = items.length > 0 && items.some((s, i) => s.key !== stops[i]?.key);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex flex-col driver-fullscreen"
        style={{ background: "hsl(var(--v7-surface-base))" }}
      >
        <header className="flex-shrink-0 flex items-center justify-between px-4 py-3" style={{ background: "hsl(var(--v7-surface-raised) / 0.95)", borderBottom: "1px solid hsl(var(--v7-border-hairline))" }}>
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-5 h-5 text-jacaranda-400" />
            <h2 className="text-base font-semibold text-text-primary">Reorder Stops</h2>
          </div>
          <button onClick={handleClose} className="p-2 text-text-tertiary hover:text-white" data-testid="button-close-reorder">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-shrink-0 px-4 py-2" style={{ background: "hsl(var(--v7-jacaranda-500) / 0.1)", borderBottom: "1px solid rgba(74,158,255,0.1)" }}>
          <p className="text-xs text-jacaranda-400">Drag stops to your preferred order. Your request will be sent to dispatch for approval.</p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <Reorder.Group axis="y" values={items} onReorder={setItems} className="space-y-2">
            {items.map((stop, idx) => (
              <Reorder.Item
                key={stop.key}
                value={stop}
                className="rounded-xl p-3 cursor-grab active:cursor-grabbing touch-none"
                style={{
                  background: stop.key !== stops[idx]?.key ? "rgba(74,158,255,0.12)" : "rgba(255,255,255,0.04)",
                  border: stop.key !== stops[idx]?.key ? "1px solid rgba(74,158,255,0.3)" : "1px solid rgba(255,255,255,0.06)",
                }}
                data-testid={`reorder-item-${stop.key}`}
              >
                <div className="flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-text-quiet flex-shrink-0" />
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold text-text-primary flex-shrink-0" style={{ background: stop.type === "C" ? "#f59e0b" : "#22c55e" }}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: stop.type === "C" ? "rgba(245,158,11,0.15)" : "rgba(34,197,94,0.15)", color: stop.type === "C" ? "#f59e0b" : "#22c55e" }}>
                        {stop.type === "C" ? "COLLECT" : "DELIVER"}
                      </span>
                      {stop.spx && <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/20 text-red-400">EXPRESS</span>}
                    </div>
                    <p className="text-sm text-text-primary truncate">{stop.addr || `${stop.sub}, ${stop.city}`}</p>
                    <p className="text-[10px] text-text-quiet">{stop.wbs.join(", ")} • {stop.pcs} pcs</p>
                  </div>
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        </div>

        <div className="flex-shrink-0 px-4 py-3 space-y-3" style={{ background: "hsl(var(--v7-surface-raised) / 0.95)", borderTop: "1px solid hsl(var(--v7-border-hairline))" }}>
          <div>
            <label className="text-xs text-text-tertiary mb-1 block">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer requested earlier delivery, road closure..."
              className="w-full rounded-lg px-3 py-2 text-sm text-text-primary placeholder-gray-500 resize-none"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid hsl(var(--v7-border-hairline))" }}
              rows={2}
              data-testid="input-reorder-reason"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={loading || !hasChanges}
            className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: hasChanges ? "linear-gradient(135deg, #4a9eff, #3b82f6)" : "rgba(255,255,255,0.1)", color: "white" }}
            data-testid="button-submit-reorder"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {loading ? "Sending..." : "Submit Reorder Request"}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
