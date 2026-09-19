import { create } from "zustand";

export type InspectorView =
  | { kind: "none" }
  | { kind: "shipment"; waybill: string }
  | { kind: "driver"; driverId: string }
  | { kind: "settings-key"; key: string }
  | { kind: "custom"; title: string; node: React.ReactNode };

interface InspectorState {
  open: boolean;
  pinned: boolean;
  view: InspectorView;
  openWith: (view: InspectorView) => void;
  close: () => void;
  togglePin: () => void;
  setView: (view: InspectorView) => void;
}

export const useInspectorStore = create<InspectorState>((set) => ({
  open: false,
  pinned: false,
  view: { kind: "none" },
  openWith: (view) => set({ open: true, view }),
  close: () => set((s) => ({ open: s.pinned ? s.open : false })),
  togglePin: () => set((s) => ({ pinned: !s.pinned })),
  setView: (view) => set({ view }),
}));
