import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Phone, MessageSquare, MapPin, EyeOff, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { DriverChip } from "@/components/ui/driver-chip";
import { CallDriverButton } from "@/components/call-driver-button";
import { cn } from "@/lib/utils";

export interface CareAlert {
  id: string;
  waybill: string;
  recipientName: string;
  recipientPhone: string;
  deliveryAddress: string;
  driverName: string;
  driverAccountId: number | null;
  shipmentStatus: string;
  etaMinutes: number | null;
  driverLat: number | null;
  driverLng: number | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  contactStatus: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EtaResponse {
  etaMinutes: number;
  etaFormatted: string;
  distanceKm: number;
  isLive: boolean;
}

const DRIFT_THRESHOLD_MIN = 30;

function maskPhone(phone: string): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  const last = digits.slice(-3);
  return phone.replace(/\d(?=\d{3})/g, "•").replace(/•+/, "•••• ").trim() || `•••• ${last}`;
}

function statusTone(status: string): "info" | "warning" | "success" | "danger" | "neutral" {
  switch (status) {
    case "collected": return "info";
    case "out-for-delivery": return "warning";
    case "delivered": return "success";
    case "failed": return "danger";
    default: return "neutral";
  }
}

function statusLabel(status: string): string {
  return status.replace(/-/g, " ");
}

function contactBorder(status: string): string {
  switch (status) {
    case "pending-contact": return "border-l-danger";
    case "contacted": return "border-l-warning";
    case "resolved": return "border-l-success";
    default: return "border-l-hairline";
  }
}

export function CareAlertCard({
  alert,
  selected,
  onSelect,
}: {
  alert: CareAlert;
  selected: boolean;
  onSelect: () => void;
}) {
  const [revealed, setRevealed] = useState(false);

  const { data: etaData } = useQuery<EtaResponse>({
    queryKey: ["/api/shipment-alerts", alert.id, "eta"],
    refetchInterval: 60_000,
    enabled: !!alert.id,
  });

  const eta = etaData?.etaMinutes ?? alert.etaMinutes;
  const distance = etaData?.distanceKm;
  const drift = eta != null && eta > DRIFT_THRESHOLD_MIN;

  return (
    <article
      onClick={onSelect}
      className={cn(
        "group relative cursor-pointer rounded-[var(--v7-radius-lg)] border border-hairline bg-surface-raised p-4 shadow-v7-sm transition-all",
        "border-l-4",
        contactBorder(alert.contactStatus),
        selected && "ring-2 ring-jacaranda-400/50 shadow-v7-md",
        "hover:shadow-v7-md hover:-translate-y-px"
      )}
      data-testid={`care-card-${alert.id}`}
    >
      <header className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-mono text-[14px] font-semibold text-text-primary tabular-nums" data-testid={`care-waybill-${alert.id}`}>
            {alert.waybill}
          </span>
          <StatusPill size="sm" tone={statusTone(alert.shipmentStatus)} dot>
            {statusLabel(alert.shipmentStatus)}
          </StatusPill>
        </div>
        <span className="text-[10px] uppercase tracking-[0.14em] text-text-quiet whitespace-nowrap">
          {alert.contactStatus.replace(/-/g, " ")}
        </span>
      </header>

      <div className="space-y-1.5 text-sm">
        <div className="font-medium text-text-primary" data-testid={`care-recipient-${alert.id}`}>
          {alert.recipientName || "Unknown recipient"}
        </div>

        {alert.recipientPhone && (
          <button
            onClick={(e) => { e.stopPropagation(); setRevealed((v) => !v); }}
            className="inline-flex items-center gap-1.5 text-text-tertiary hover:text-text-primary text-xs font-mono transition-colors"
            data-testid={`care-phone-toggle-${alert.id}`}
            title={revealed ? "Hide phone" : "Reveal phone"}
          >
            {revealed ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
            <span className="tabular-nums">{revealed ? alert.recipientPhone : maskPhone(alert.recipientPhone)}</span>
          </button>
        )}

        <div className="flex items-start gap-1.5 text-xs text-text-tertiary">
          <MapPin className="size-3.5 mt-0.5 shrink-0" />
          <span className="leading-snug">{alert.deliveryAddress || "Address pending"}</span>
        </div>

        {alert.driverName && (
          <div className="pt-1">
            <DriverChip
              driver={alert.driverName.split(/\s+/)[0].toLowerCase()}
              name={alert.driverName}
              size="sm"
            />
          </div>
        )}

        {eta != null && (
          <div
            className={cn(
              "inline-flex items-center gap-2 text-xs font-medium tabular-nums px-2 py-1 rounded-[var(--v7-radius-pill)] mt-1",
              drift
                ? "bg-warning/15 text-warning"
                : "bg-surface-overlay text-text-tertiary"
            )}
            data-testid={`care-eta-${alert.id}`}
          >
            <span>{eta} min</span>
            {distance != null && <span className="opacity-70">· {distance.toFixed(1)} km away</span>}
            {drift && <span className="text-[10px] uppercase tracking-[0.12em]">drift</span>}
          </div>
        )}
      </div>

      <footer className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {alert.recipientPhone ? (
          <CallDriverButton
            phone={alert.recipientPhone}
            driverName={alert.recipientName || alert.waybill}
            variant="chip"
            testId={`care-call-${alert.id}`}
          />
        ) : (
          <Button size="sm" variant="ghost" disabled className="h-8 text-xs">
            <Phone className="size-3.5 mr-1" /> No phone
          </Button>
        )}
        {alert.recipientPhone && (
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            data-testid={`care-text-${alert.id}`}
          >
            <a
              href={`https://wa.me/${alert.recipientPhone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <MessageSquare className="size-3.5 mr-1" /> Text
            </a>
          </Button>
        )}
      </footer>
    </article>
  );
}
