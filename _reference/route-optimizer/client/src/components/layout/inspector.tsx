import { X, Pin, PinOff } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useInspectorStore } from "@/stores/inspector-store";

export function Inspector() {
  const { open, pinned, view, close, togglePin } = useInspectorStore();

  const showing = open || pinned;

  return (
    <AnimatePresence initial={false}>
      {showing && (
        <motion.aside
          key="inspector"
          initial={{ x: 380, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 380, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ width: 380 }}
          className="flex h-full flex-col border-l border-border bg-card text-card-foreground shadow-xl"
          data-testid="inspector"
        >
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold" data-testid="inspector-title">
              {viewTitle(view)}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={togglePin}
                className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                data-testid="inspector-pin"
                title={pinned ? "Unpin" : "Pin"}
              >
                {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </button>
              <button
                onClick={close}
                className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                data-testid="inspector-close"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-4 text-sm">
            {renderBody(view)}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function viewTitle(view: ReturnType<typeof useInspectorStore.getState>["view"]) {
  switch (view.kind) {
    case "shipment": return `Shipment ${view.waybill}`;
    case "driver": return `Driver detail`;
    case "settings-key": return `Setting · ${view.key}`;
    case "custom": return view.title;
    default: return "Inspector";
  }
}

function renderBody(view: ReturnType<typeof useInspectorStore.getState>["view"]) {
  switch (view.kind) {
    case "custom": return view.node;
    case "none":
      return <p className="text-muted-foreground">Select an item from the canvas to inspect it here.</p>;
    case "shipment":
      return <p className="text-muted-foreground">Detail panel for waybill <span className="font-mono">{view.waybill}</span> will populate here.</p>;
    case "driver":
      return <p className="text-muted-foreground">Driver profile panel for <span className="font-mono">{view.driverId}</span>.</p>;
    case "settings-key":
      return <p className="text-muted-foreground">Settings key <span className="font-mono">{view.key}</span>.</p>;
  }
}
