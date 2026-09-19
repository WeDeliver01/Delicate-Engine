import { useEffect, useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { getFleetSettings } from "@/lib/fleet";
import { Activity, Inbox, Truck, Map, Phone, Archive, BarChart3, Settings, Package, FileText } from "lucide-react";

const PAGES = [
  { href: "/intake", label: "Intake", Icon: Inbox },
  { href: "/live", label: "Live Ops", Icon: Activity },
  { href: "/fleet", label: "Fleet", Icon: Truck },
  { href: "/traffic", label: "Traffic", Icon: Map },
  { href: "/care", label: "Client Care", Icon: Phone },
  { href: "/archive", label: "Archive", Icon: Archive },
  { href: "/insights", label: "Insights", Icon: BarChart3 },
  { href: "/analytics", label: "Driver Analytics", Icon: BarChart3 },
  { href: "/settings", label: "Settings", Icon: Settings },
  { href: "/settings/audit", label: "Audit Log", Icon: FileText },
];

const SETTINGS_KEYS = [
  "fleet", "drivers", "fuel-price", "city-factor", "service-time", "depots", "handoff-points", "client-accounts", "webhooks", "audit",
];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();

  type DriverItem = { id: string; name: string; color?: string; active?: boolean };
  const drivers = useMemo<DriverItem[]>(() => {
    try { return getFleetSettings().drivers as DriverItem[]; } catch { return []; }
  }, [open]);

  type WaybillLike = { wb?: unknown; waybill?: unknown; waybillNumber?: unknown };
  type WaybillContainer = WaybillLike[] | { shipments?: WaybillLike[]; items?: WaybillLike[] };
  const recentWaybills = useMemo<string[]>(() => {
    if (!open) return [];
    const seen = new Set<string>();
    queryClient.getQueryCache().getAll().forEach((q) => {
      const data = q.state.data as WaybillContainer | undefined;
      if (!data) return;
      const items: WaybillLike[] = Array.isArray(data)
        ? data
        : Array.isArray(data.shipments)
          ? data.shipments
          : Array.isArray(data.items)
            ? data.items
            : [];
      items.slice(0, 30).forEach((s) => {
        const wb = s?.wb ?? s?.waybill ?? s?.waybillNumber;
        if (typeof wb === "string" && wb && !seen.has(wb)) seen.add(wb);
      });
    });
    return Array.from(seen).slice(0, 12);
  }, [open, queryClient]);

  const go = (href: string) => {
    onOpenChange(false);
    setLocation(href);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl p-0 gap-0 overflow-hidden border-none shadow-2xl"
        style={{
          background: "linear-gradient(135deg, hsl(var(--background)) 0%, hsl(var(--background)) 100%)",
          backdropFilter: "blur(12px)",
        }}
        data-testid="command-palette"
      >
        <VisuallyHidden>
          <DialogTitle>Command Palette</DialogTitle>
        </VisuallyHidden>
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(80% 60% at 50% 0%, hsl(var(--jacaranda-500, 268 60% 55%) / 0.18), transparent 60%)",
          }}
        />
        <Command className="relative bg-transparent">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Type to search pages, drivers, waybills…"
            data-testid="palette-input"
          />
          <CommandList className="max-h-[420px]">
            <CommandEmpty>No results.</CommandEmpty>

            <CommandGroup heading="Pages">
              {PAGES.map((p) => (
                <CommandItem key={p.href} value={`page ${p.label} ${p.href}`} onSelect={() => go(p.href)} data-testid={`palette-page-${p.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  <p.Icon className="h-4 w-4" />
                  <span>{p.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground font-mono">{p.href}</span>
                </CommandItem>
              ))}
            </CommandGroup>

            {drivers.length > 0 && (
              <CommandGroup heading="Drivers">
                {drivers.map((d) => (
                  <CommandItem
                    key={d.id}
                    value={`driver ${d.name} ${d.id}`}
                    onSelect={() => go("/fleet")}
                    data-testid={`palette-driver-${d.id}`}
                  >
                    <span className="h-4 w-4 rounded-full" style={{ background: d.color || "#666" }} />
                    <span>{d.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{d.active === false ? "off" : "active"}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {recentWaybills.length > 0 && (
              <CommandGroup heading="Recent waybills">
                {recentWaybills.map((wb) => (
                  <CommandItem
                    key={wb}
                    value={`waybill ${wb}`}
                    onSelect={() => go(`/care?waybill=${encodeURIComponent(wb)}`)}
                    data-testid={`palette-waybill-${wb}`}
                  >
                    <Package className="h-4 w-4" />
                    <span className="font-mono">{wb}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandGroup heading="Settings">
              {SETTINGS_KEYS.map((k) => (
                <CommandItem
                  key={k}
                  value={`setting ${k}`}
                  onSelect={() => go(`/settings#${k}`)}
                  data-testid={`palette-setting-${k}`}
                >
                  <Settings className="h-4 w-4" />
                  <span>{k}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>

          <svg
            aria-hidden
            viewBox="0 0 64 64"
            className="absolute bottom-2 right-2 h-12 w-12 opacity-15 pointer-events-none"
            style={{ color: "hsl(var(--jacaranda-500, 268 60% 55%))" }}
          >
            <path
              d="M32 4 C 36 18, 50 22, 60 32 C 50 42, 36 46, 32 60 C 28 46, 14 42, 4 32 C 14 22, 28 18, 32 4 Z"
              fill="currentColor"
            />
          </svg>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
