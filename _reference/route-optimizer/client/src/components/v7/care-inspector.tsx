import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Phone, MessageSquare, Send, CheckCircle2, Truck, Package, MapPin, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { DriverChip } from "@/components/ui/driver-chip";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { CareAlert } from "./care-alert-card";

interface ContactLog {
  id: number;
  alertId: string;
  contactedBy: string;
  contactMethod: string;
  outcome: string;
  notes: string | null;
  createdAt: string;
}

interface ActivityEntry {
  id: number;
  type: string;
  title: string;
  message: string;
  createdAt: string;
}

const TEMPLATES = [
  { label: "Soft check-in", body: "Hi {name}, your delivery is on the way. The driver should be with you shortly." },
  { label: "ETA delay", body: "Hi {name}, your driver is running about {eta} minutes behind. We'll keep you posted." },
  { label: "Reschedule", body: "Hi {name}, we couldn't reach you for delivery. Please reply with a better time." },
];

const JOURNEY_STEPS: { key: string; label: string }[] = [
  { key: "collected", label: "Collected" },
  { key: "in_transit", label: "In transit" },
  { key: "out-for-delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
];

function fmtDateTime(s: string): string {
  try { return new Date(s).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return s; }
}

function findStepTime(activity: ActivityEntry[], key: string): string | null {
  const norm = key.replace(/[-_ ]/g, "");
  const match = activity.find((a) => a.type.replace(/[-_ ]/g, "").toLowerCase().includes(norm));
  return match?.createdAt ?? null;
}

export function CareInspector({ alert }: { alert: CareAlert }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");

  const { data: detail } = useQuery<CareAlert & { contactLogs: ContactLog[] }>({
    queryKey: ["/api/shipment-alerts", alert.id],
  });

  const { data: activity = [] } = useQuery<ActivityEntry[]>({
    queryKey: ["/api/shipment-alerts", alert.id, "activity"],
  });

  const contactLogs = detail?.contactLogs ?? [];

  const whatsappMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiRequest("POST", `/api/shipment-alerts/${alert.id}/whatsapp`, { body });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "WhatsApp sent", description: "Message delivered via Twilio and logged." });
      setDraft("");
      qc.invalidateQueries({ queryKey: ["/api/shipment-alerts"] });
    },
    onError: (err) => {
      toast({
        title: "Failed to send WhatsApp",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const useTemplate = (body: string) => {
    const filled = body
      .replace("{name}", alert.recipientName?.split(/\s+/)[0] || "there")
      .replace("{eta}", String(alert.etaMinutes ?? 30));
    setDraft(filled);
  };

  const sendText = () => {
    if (!alert.recipientPhone || !draft.trim()) return;
    whatsappMutation.mutate(draft);
  };

  return (
    <div className="space-y-6" data-testid="care-inspector">
      <header className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Package className="size-4 text-jacaranda-400" />
          <span className="font-mono text-sm font-semibold">{alert.waybill}</span>
          <StatusPill size="sm" tone="info" dot>{alert.shipmentStatus.replace(/-/g, " ")}</StatusPill>
        </div>
        <div className="font-display text-lg tracking-tight">{alert.recipientName || "Unknown recipient"}</div>
        <div className="flex items-start gap-1.5 text-xs text-text-tertiary">
          <MapPin className="size-3.5 mt-0.5 shrink-0" />
          <span>{alert.deliveryAddress}</span>
        </div>
        {alert.driverName && (
          <DriverChip
            driver={alert.driverName.split(/\s+/)[0].toLowerCase()}
            name={alert.driverName}
            size="sm"
          />
        )}
      </header>

      <section>
        <h3 className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mb-3">Quick actions</h3>
        <div className="flex gap-2">
          {alert.recipientPhone && (
            <Button asChild variant="secondary" size="sm" className="flex-1">
              <a href={`tel:${alert.recipientPhone}`} data-testid="care-inspector-call">
                <Phone className="size-3.5 mr-1" /> Call
              </a>
            </Button>
          )}
          {alert.recipientPhone && (
            <Button asChild variant="ghost" size="sm" className="flex-1">
              <a
                href={`https://wa.me/${alert.recipientPhone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="care-inspector-text"
              >
                <MessageSquare className="size-3.5 mr-1" /> WhatsApp
              </a>
            </Button>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mb-3">Suggested messages</h3>
        <div className="space-y-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => useTemplate(t.body)}
              className="w-full text-left rounded-[var(--v7-radius-md)] border border-hairline bg-surface-overlay/60 px-3 py-2 hover:bg-surface-overlay hover:border-border-soft transition-colors"
              data-testid={`care-template-${t.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div className="text-xs font-medium text-text-primary">{t.label}</div>
              <div className="text-[11px] text-text-tertiary mt-0.5 leading-snug">{t.body}</div>
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Compose a message…"
            rows={3}
            className="text-xs"
            data-testid="care-message-draft"
          />
          <Button
            size="sm"
            disabled={!draft.trim() || !alert.recipientPhone || whatsappMutation.isPending}
            onClick={sendText}
            className="w-full"
            data-testid="care-send-message"
          >
            {whatsappMutation.isPending ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Send className="size-3.5 mr-1" />}
            Send via WhatsApp
          </Button>
        </div>
      </section>

      <section>
        <h3 className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mb-3">Communication history</h3>
        {contactLogs.length === 0 ? (
          <p className="text-xs text-text-tertiary italic">No contact attempts yet.</p>
        ) : (
          <ol className="space-y-2.5">
            {contactLogs.map((log) => (
              <li key={log.id} className="flex gap-2.5" data-testid={`care-log-${log.id}`}>
                <div className="flex flex-col items-center">
                  <span className={`size-2 rounded-full mt-1.5 ${
                    log.outcome === "reached-confirmed" ? "bg-success" :
                    log.outcome === "no-answer" ? "bg-danger" :
                    "bg-warning"
                  }`} />
                  <span className="flex-1 w-px bg-hairline mt-1" />
                </div>
                <div className="flex-1 pb-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-text-primary">{log.contactedBy}</span>
                    <span className="text-text-quiet">·</span>
                    <span className="text-text-tertiary">{log.contactMethod}</span>
                    <span className="text-text-quiet">·</span>
                    <span className="text-text-tertiary">{log.outcome.replace(/-/g, " ")}</span>
                  </div>
                  {log.notes && <p className="text-[11px] text-text-tertiary mt-0.5">{log.notes}</p>}
                  <p className="text-[10px] text-text-quiet mt-0.5">{fmtDateTime(log.createdAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h3 className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mb-3">Shipment journey</h3>
        <ol className="space-y-2.5">
          {JOURNEY_STEPS.map((step, i) => {
            const time = findStepTime(activity, step.key);
            const reached = time != null || JOURNEY_STEPS.findIndex(s => s.key === alert.shipmentStatus) >= i;
            return (
              <li key={step.key} className="flex items-center gap-2.5" data-testid={`care-journey-${step.key}`}>
                <span className={`size-2.5 rounded-full ${reached ? "bg-jacaranda-400" : "bg-hairline"}`} />
                <span className={`text-xs ${reached ? "text-text-primary font-medium" : "text-text-tertiary"}`}>
                  {step.label}
                </span>
                {time && (
                  <span className="ml-auto text-[10px] text-text-quiet tabular-nums">{fmtDateTime(time)}</span>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
