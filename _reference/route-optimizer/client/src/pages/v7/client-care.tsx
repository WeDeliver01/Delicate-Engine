import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Phone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/hooks/use-toast";
import { useInspectorStore } from "@/stores/inspector-store";
import { CareAlertCard, type CareAlert } from "@/components/v7/care-alert-card";
import { CareInspector } from "@/components/v7/care-inspector";
import { cn } from "@/lib/utils";

type FilterId = "all" | "pending-contact" | "contacted" | "resolved";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending-contact", label: "Pending" },
  { id: "contacted", label: "Contacted" },
  { id: "resolved", label: "Resolved" },
];

export default function ClientCarePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterId>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openWith = useInspectorStore((s) => s.openWith);
  const setView = useInspectorStore((s) => s.setView);

  const { data: alerts = [], isLoading } = useQuery<CareAlert[]>({
    queryKey: ["/api/shipment-alerts"],
    refetchInterval: 30_000,
  });

  // Live SSE stream
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/shipment-alerts/stream");
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === "connected") return;
          qc.invalidateQueries({ queryKey: ["/api/shipment-alerts"] });
          qc.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
          if (data.waybill) {
            toast({ title: data.message || "New shipment alert", description: data.waybill });
          }
        } catch {}
      };
    } catch {}
    return () => { es?.close(); };
  }, [qc, toast]);

  const counts = useMemo(() => ({
    "all": alerts.length,
    "pending-contact": alerts.filter((a) => a.contactStatus === "pending-contact").length,
    "contacted": alerts.filter((a) => a.contactStatus === "contacted").length,
    "resolved": alerts.filter((a) => a.contactStatus === "resolved").length,
  }), [alerts]);

  const filtered = useMemo(() => {
    let list = alerts;
    if (filter !== "all") list = list.filter((a) => a.contactStatus === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) =>
        a.waybill.toLowerCase().includes(q) ||
        a.recipientName.toLowerCase().includes(q) ||
        a.driverName.toLowerCase().includes(q) ||
        a.deliveryAddress.toLowerCase().includes(q)
      );
    }
    return list;
  }, [alerts, filter, search]);

  function selectAlert(a: CareAlert) {
    setSelectedId(a.id);
    openWith({
      kind: "custom",
      title: `Care · ${a.waybill}`,
      node: <CareInspector alert={a} />,
    });
  }

  // Refresh inspector content when selected alert updates
  useEffect(() => {
    if (!selectedId) return;
    const found = alerts.find((a) => a.id === selectedId);
    if (found) {
      setView({ kind: "custom", title: `Care · ${found.waybill}`, node: <CareInspector alert={found} /> });
    }
  }, [alerts, selectedId, setView]);

  return (
    <div className="flex h-full min-h-0 bg-surface-base text-text-primary" data-testid="client-care-page">
      {/* Left filter rail (200px) */}
      <aside className="w-[200px] shrink-0 border-r border-hairline bg-surface-base/60 p-4 flex flex-col gap-1" data-testid="care-filter-rail">
        <div className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mb-2">Status</div>
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "flex items-center justify-between rounded-[var(--v7-radius-md)] px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-jacaranda-500/15 text-jacaranda-200 border border-jacaranda-400/30"
                  : "text-text-secondary hover:bg-surface-overlay hover:text-text-primary border border-transparent"
              )}
              data-testid={`care-filter-${f.id}`}
            >
              <span className="font-medium">{f.label}</span>
              <span className="font-mono text-xs tabular-nums text-text-tertiary">{counts[f.id]}</span>
            </button>
          );
        })}
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="border-b border-hairline px-6 py-4">
          <div className="flex items-center gap-3 mb-3">
            <Phone className="size-5 text-jacaranda-400" />
            <div className="font-display text-2xl tracking-tight">Client Care</div>
            <span className="text-xs text-text-tertiary">
              {counts["pending-contact"]} pending · {counts.contacted} contacted · {counts.resolved} resolved
            </span>
          </div>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-quiet pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search waybill, recipient, driver, address…"
              className="pl-9"
              data-testid="care-search"
            />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="text-sm text-text-tertiary">Loading alerts…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Phone className="size-5" />}
              title={search ? "No matching alerts" : "No alerts in this view"}
              description={search ? `Nothing matches “${search}”.` : "When drivers collect or deliver shipments, alerts will land here."}
            />
          ) : (
            <div className="space-y-3 max-w-3xl">
              {filtered.map((a) => (
                <CareAlertCard
                  key={a.id}
                  alert={a}
                  selected={selectedId === a.id}
                  onSelect={() => selectAlert(a)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
