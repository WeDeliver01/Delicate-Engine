import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, Info } from "lucide-react";

interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

let toastId = 0;
const listeners: Array<(toast: Toast) => void> = [];

export function showDriverToast(message: string, type: "success" | "error" | "info" = "info") {
  const toast: Toast = { id: ++toastId, message, type };
  listeners.forEach((fn) => fn(toast));
  if (navigator.vibrate) {
    navigator.vibrate(type === "error" ? [100, 50, 100] : [50]);
  }
}

export function DriverToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Toast) => {
    setToasts((prev) => [...prev.slice(-2), toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 3000);
  }, []);

  useEffect(() => {
    listeners.push(addToast);
    return () => {
      const i = listeners.indexOf(addToast);
      if (i >= 0) listeners.splice(i, 1);
    };
  }, [addToast]);

  const icons = {
    success: <CheckCircle2 className="w-4 h-4 text-success" />,
    error: <XCircle className="w-4 h-4 text-red-400" />,
    info: <Info className="w-4 h-4 text-jacaranda-400" />,
  };

  return (
    <div className="fixed top-16 left-0 right-0 z-[9999] flex flex-col items-center gap-2 pointer-events-none px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg"
            style={{ background: "hsl(var(--v7-surface-raised) / 0.95)", border: "1px solid hsl(var(--v7-border-hairline))", backdropFilter: "blur(12px)" }}
          >
            {icons[t.type]}
            <span className="text-sm text-text-primary">{t.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
