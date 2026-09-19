/**
 * client/src/pages/shipments.tsx
 *
 * Client Care workflow page with three sections:
 * 1. Alert banner — polls /api/notifications/unread-count every 15s,
 *    plays audio ping and shows toast on new shipment_collected notifications.
 * 2. Shipment queue — active alerts as cards, color-coded by contact status,
 *    live ETA badge refreshing every 60s.
 * 3. Action drawer — opens on card click, with Call/Text buttons,
 *    outcome dropdown, notes field, and submit button.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Bell, BellRing, Phone, MessageSquare, MapPin, Clock, Package,
  CheckCircle2, AlertTriangle, User, Truck, Navigation, X,
  Send, Loader2, RefreshCw, Volume2, Search, Filter, Trash2,
  Activity, ArrowRight,
} from "lucide-react";

// ══════════════════════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════════════════════

interface ShipmentAlert {
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

interface EtaResponse {
  etaMinutes: number;
  etaFormatted: string;
  distanceKm: number;
  driverLat: number | null;
  driverLng: number | null;
  isLive: boolean;
  calculatedAt: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Notification sound
// ══════════════════════════════════════════════════════════════════════════════

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
    // Second tone
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.frequency.value = 1100;
    osc2.type = "sine";
    gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc2.start(ctx.currentTime + 0.15);
    osc2.stop(ctx.currentTime + 0.6);
  } catch {
    // Audio not available
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Status helpers
// ══════════════════════════════════════════════════════════════════════════════

function contactStatusColor(status: string): string {
  switch (status) {
    case "pending-contact": return "border-red-500/40 bg-red-500/5";
    case "contacted": return "border-amber-500/40 bg-amber-500/5";
    case "resolved": return "border-green-500/40 bg-green-500/5";
    default: return "";
  }
}

function contactStatusBadge(status: string): string {
  switch (status) {
    case "pending-contact": return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
    case "contacted": return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "resolved": return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
    default: return "";
  }
}

function shipmentStatusLabel(status: string): string {
  switch (status) {
    case "collected": return "Collected";
    case "out-for-delivery": return "Out for Delivery";
    case "delivered": return "Delivered";
    case "failed": return "Failed";
    default: return status;
  }
}

function shipmentStatusBadge(status: string): string {
  switch (status) {
    case "collected": return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
    case "out-for-delivery": return "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30";
    case "delivered": return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
    case "failed": return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
    default: return "";
  }
}

function fmtTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return dateStr;
  }
}

function fmtDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return dateStr;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Notification Bell Component
// ══════════════════════════════════════════════════════════════════════════════

function NotificationBell() {
  const { toast } = useToast();
  const prevCountRef = useRef(0);

  const { data } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    refetchInterval: 15000,
  });

  const count = data?.count || 0;

  useEffect(() => {
    if (count > prevCountRef.current && prevCountRef.current >= 0) {
      playNotificationSound();
      toast({
        title: "New shipment alert",
        description: `${count - prevCountRef.current} new alert${count - prevCountRef.current > 1 ? "s" : ""} require your attention`,
      });
    }
    prevCountRef.current = count;
  }, [count, toast]);

  return (
    <div className="relative" data-testid="notification-bell">
      {count > 0 ? (
        <BellRing className="w-5 h-5 text-amber-500 animate-pulse" />
      ) : (
        <Bell className="w-5 h-5 text-muted-foreground" />
      )}
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ETA Badge Component — refreshes every 60s
// ══════════════════════════════════════════════════════════════════════════════

function EtaBadge({ alertId, initialEta }: { alertId: string; initialEta: number | null }) {
  const { data: etaData } = useQuery<EtaResponse>({
    queryKey: [`/api/shipment-alerts/${alertId}/eta`],
    refetchInterval: 60000,
    enabled: !!alertId,
  });

  const eta = etaData?.etaMinutes ?? initialEta;
  const isLive = etaData?.isLive ?? false;

  if (eta == null) return null;

  return (
    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${
      eta <= 10 ? "bg-green-500/20 text-green-700 dark:text-green-400" :
      eta <= 30 ? "bg-amber-500/20 text-amber-700 dark:text-amber-400" :
      "bg-blue-500/20 text-blue-700 dark:text-blue-400"
    }`} data-testid={`eta-badge-${alertId}`}>
      <Clock className="w-3 h-3" />
      {eta} min
      {isLive && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
      {etaData?.distanceKm != null && (
        <span className="text-[10px] opacity-70">{etaData.distanceKm.toFixed(1)}km</span>
      )}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Action Drawer — Contact logging
// ══════════════════════════════════════════════════════════════════════════════

function ActionDrawer({
  alert,
  open,
  onClose,
  onSubmitted,
}: {
  alert: ShipmentAlert | null;
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [contactMethod, setContactMethod] = useState<string>("");
  const [outcome, setOutcome] = useState<string>("");
  const [notes, setNotes] = useState("");

  const { data: alertDetail } = useQuery<ShipmentAlert & { contactLogs: ContactLog[] }>({
    queryKey: ["/api/shipment-alerts", alert?.id],
    queryFn: async () => {
      const res = await fetch(`/api/shipment-alerts/${alert!.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: open && !!alert?.id,
  });

  const { data: activityLog = [] } = useQuery<ActivityEntry[]>({
    queryKey: ["/api/shipment-alerts", alert?.id, "activity"],
    queryFn: async () => {
      const res = await fetch(`/api/shipment-alerts/${alert!.id}/activity`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: open && !!alert?.id,
  });

  const contactLogs = alertDetail?.contactLogs || [];

  const submitMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/shipment-alerts/${alert!.id}/contact-log`, {
        contactMethod,
        outcome,
        notes,
      });
    },
    onSuccess: () => {
      toast({ title: "Contact logged", description: `${outcome} via ${contactMethod}` });
      queryClient.invalidateQueries({ queryKey: ["/api/shipment-alerts"] });
      queryClient.invalidateQueries({ queryKey: [`/api/shipment-alerts/${alert?.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      setContactMethod("");
      setOutcome("");
      setNotes("");
      onSubmitted();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/shipment-alerts/${alert!.id}`);
    },
    onSuccess: () => {
      toast({ title: "Alert deleted", description: `${alert?.waybill} removed` });
      queryClient.invalidateQueries({ queryKey: ["/api/shipment-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!alert) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="action-drawer">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-[16px]" data-testid="drawer-title">
              <Package className="w-5 h-5 text-primary" />
              {alert.waybill}
              <Badge variant="outline" className={`text-[10px] ${shipmentStatusBadge(alert.shipmentStatus)}`}>
                {shipmentStatusLabel(alert.shipmentStatus)}
              </Badge>
            </DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-500/10"
              onClick={() => {
                if (window.confirm(`Delete alert for ${alert.waybill}? This will also remove related notifications and contact logs.`)) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-alert"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Recipient info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-md bg-muted/30">
              <p className="text-[10px] text-muted-foreground font-medium">Recipient</p>
              <p className="text-[13px] font-semibold mt-0.5">{alert.recipientName || "—"}</p>
            </div>
            <div className="p-3 rounded-md bg-muted/30">
              <p className="text-[10px] text-muted-foreground font-medium">Phone</p>
              <p className="text-[13px] font-semibold mt-0.5">
                {alert.recipientPhone ? (
                  <a href={`tel:${alert.recipientPhone}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                    {alert.recipientPhone}
                  </a>
                ) : "—"}
              </p>
            </div>
            <div className="p-3 rounded-md bg-muted/30 col-span-2">
              <p className="text-[10px] text-muted-foreground font-medium">Delivery Address</p>
              <p className="text-[13px] font-semibold mt-0.5">{alert.deliveryAddress || "—"}</p>
            </div>
            <div className="p-3 rounded-md bg-muted/30">
              <p className="text-[10px] text-muted-foreground font-medium">Driver</p>
              <p className="text-[13px] font-semibold mt-0.5">{alert.driverName || "—"}</p>
            </div>
            <div className="p-3 rounded-md bg-muted/30">
              <p className="text-[10px] text-muted-foreground font-medium">Live ETA</p>
              <div className="mt-0.5">
                <EtaBadge alertId={alert.id} initialEta={alert.etaMinutes} />
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex gap-2">
            {alert.recipientPhone && (
              <Button variant="outline" className="flex-1 font-bold" asChild>
                <a href={`tel:${alert.recipientPhone}`} data-testid="button-call">
                  <Phone className="w-4 h-4 mr-1.5" />
                  Call
                </a>
              </Button>
            )}
            {alert.recipientPhone && (
              <Button variant="outline" className="flex-1 font-bold" asChild>
                <a href={`https://wa.me/${alert.recipientPhone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noopener noreferrer" data-testid="button-whatsapp">
                  <MessageSquare className="w-4 h-4 mr-1.5" />
                  WhatsApp
                </a>
              </Button>
            )}
            {alert.recipientPhone && (
              <Button variant="outline" className="flex-1 font-bold" asChild>
                <a href={`sms:${alert.recipientPhone}`} data-testid="button-sms">
                  <Send className="w-4 h-4 mr-1.5" />
                  SMS
                </a>
              </Button>
            )}
          </div>

          <Separator />

          {/* Contact log form */}
          <div className="space-y-3">
            <h3 className="text-[13px] font-bold">Log Contact Attempt</h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Method</label>
                <Select value={contactMethod} onValueChange={setContactMethod}>
                  <SelectTrigger data-testid="select-method">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call">Phone Call</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Outcome</label>
                <Select value={outcome} onValueChange={setOutcome}>
                  <SelectTrigger data-testid="select-outcome">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reached-confirmed">Reached — Confirmed</SelectItem>
                    <SelectItem value="no-answer">No Answer</SelectItem>
                    <SelectItem value="alternative-receiver">Alternative Receiver</SelectItem>
                    <SelectItem value="voicemail">Voicemail</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">Notes</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional details..."
                className="text-[12px] resize-none"
                rows={2}
                data-testid="input-contact-notes"
              />
            </div>

            <Button
              onClick={() => submitMutation.mutate()}
              disabled={!contactMethod || !outcome || submitMutation.isPending}
              className="w-full font-bold"
              data-testid="button-submit-log"
            >
              {submitMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-1.5" />
              )}
              Log Contact
            </Button>
          </div>

          {/* Previous contact logs */}
          {contactLogs.length > 0 && (
            <>
              <Separator />
              <div>
                <h3 className="text-[13px] font-bold mb-2">Contact History ({contactLogs.length})</h3>
                <div className="space-y-1.5">
                  {contactLogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-2 p-2 rounded-md bg-muted/20 text-[11px]" data-testid={`contact-log-${log.id}`}>
                      <div className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${
                        log.outcome === "reached-confirmed" || log.outcome === "alternative-receiver"
                          ? "bg-green-500"
                          : log.outcome === "no-answer"
                            ? "bg-red-500"
                            : "bg-amber-500"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{log.contactedBy}</span>
                          <Badge variant="secondary" className="text-[9px]">{log.contactMethod}</Badge>
                          <Badge variant="outline" className="text-[9px]">{log.outcome.replace(/-/g, " ")}</Badge>
                        </div>
                        {log.notes && <p className="text-muted-foreground mt-0.5">{log.notes}</p>}
                        <p className="text-muted-foreground/60 mt-0.5">{fmtDateTime(log.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Status Change Activity Log */}
          <Separator />
          <div>
            <h3 className="text-[13px] font-bold mb-2 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-primary" />
              Status Activity Log
            </h3>
            {activityLog.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">No status events recorded yet</p>
            ) : (
              <div className="space-y-1" data-testid="activity-log">
                {activityLog.map((entry, idx) => (
                  <div key={entry.id} className="flex items-start gap-2 text-[11px]">
                    <div className="flex flex-col items-center mt-0.5">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        entry.type.includes("delivered") ? "bg-green-500"
                          : entry.type.includes("failed") ? "bg-red-500"
                          : entry.type.includes("out_for_delivery") ? "bg-purple-500"
                          : entry.type.includes("collected") ? "bg-blue-500"
                          : "bg-muted-foreground"
                      }`} />
                      {idx < activityLog.length - 1 && (
                        <div className="w-px h-4 bg-border mt-0.5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 pb-1">
                      <p className="font-semibold">{entry.title}</p>
                      <p className="text-muted-foreground">{entry.message}</p>
                      <p className="text-muted-foreground/60 text-[10px]">{fmtDateTime(entry.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Shipments Page
// ══════════════════════════════════════════════════════════════════════════════

export default function ShipmentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedAlert, setSelectedAlert] = useState<ShipmentAlert | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // SSE connection for real-time updates
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/shipment-alerts/stream");
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === "connected") return;
          // Refresh data on new alert
          queryClient.invalidateQueries({ queryKey: ["/api/shipment-alerts"] });
          queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
          playNotificationSound();
          toast({
            title: data.message || "New shipment alert",
            description: `${data.waybill} — ${data.recipientName || ""}`,
          });
        } catch {}
      };
    } catch {}
    return () => { es?.close(); };
  }, [queryClient, toast]);

  // Fetch alerts
  const { data: alerts = [], isLoading } = useQuery<ShipmentAlert[]>({
    queryKey: ["/api/shipment-alerts", statusFilter !== "all" ? `?status=${statusFilter}` : ""],
    queryFn: async () => {
      const url = statusFilter !== "all"
        ? `/api/shipment-alerts?status=${statusFilter}`
        : "/api/shipment-alerts";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch alerts");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const deleteAlertMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/shipment-alerts/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Alert deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/shipment-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/notifications/read-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  // Filter alerts
  const filtered = useMemo(() => {
    if (!search.trim()) return alerts;
    const q = search.toLowerCase();
    return alerts.filter((a) =>
      a.waybill.toLowerCase().includes(q) ||
      a.recipientName.toLowerCase().includes(q) ||
      a.recipientPhone.includes(q) ||
      a.driverName.toLowerCase().includes(q) ||
      a.deliveryAddress.toLowerCase().includes(q)
    );
  }, [alerts, search]);

  // Stats
  const pendingCount = alerts.filter((a) => a.contactStatus === "pending-contact").length;
  const contactedCount = alerts.filter((a) => a.contactStatus === "contacted").length;
  const resolvedCount = alerts.filter((a) => a.contactStatus === "resolved").length;

  function handleCardClick(alert: ShipmentAlert) {
    setSelectedAlert(alert);
    setDrawerOpen(true);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="shipments-page">
      {/* Header */}
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold" data-testid="text-page-title">Client Care — Shipments</h2>
              <p className="text-[12px] text-muted-foreground">
                {pendingCount} pending · {contactedCount} contacted · {resolvedCount} resolved
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllReadMutation.mutate()}
              className="font-bold text-[11px]"
              data-testid="button-mark-all-read"
            >
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Clear All
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <div className="flex gap-1 p-1 bg-muted/40 rounded-lg" data-testid="status-filter-tabs">
            {[
              { id: "all", label: "All", count: alerts.length },
              { id: "pending-contact", label: "Pending", count: pendingCount },
              { id: "contacted", label: "Contacted", count: contactedCount },
              { id: "resolved", label: "Resolved", count: resolvedCount },
            ].map(({ id, label, count }) => (
              <button
                key={id}
                onClick={() => setStatusFilter(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all ${
                  statusFilter === id
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`tab-${id}`}
              >
                {label}
                <span className="text-[10px] font-bold tabular-nums opacity-60">{count}</span>
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search waybill, recipient, driver..."
              className="pl-9 text-[12px] h-8"
              data-testid="input-search-alerts"
            />
          </div>
        </div>
      </div>

      {/* Alert Queue */}
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && filtered.length === 0 && (
            <Card>
              <CardContent className="py-16 text-center">
                <Package className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                <h3 className="text-[15px] font-semibold mb-1">
                  {search ? "No matching alerts" : statusFilter !== "all" ? `No ${statusFilter.replace(/-/g, " ")} alerts` : "No shipment alerts yet"}
                </h3>
                <p className="text-[13px] text-muted-foreground max-w-sm mx-auto">
                  {search
                    ? `No alerts match "${search}"`
                    : "Alerts will appear here when drivers collect or deliver shipments via the Route Optimizer."}
                </p>
              </CardContent>
            </Card>
          )}

          {filtered.map((alert) => (
            <Card
              key={alert.id}
              className={`cursor-pointer hover-elevate transition-shadow ${contactStatusColor(alert.contactStatus)}`}
              onClick={() => handleCardClick(alert)}
              data-testid={`alert-card-${alert.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-[14px] font-bold font-mono" data-testid={`alert-waybill-${alert.id}`}>
                        {alert.waybill}
                      </span>
                      <Badge variant="outline" className={`text-[10px] ${shipmentStatusBadge(alert.shipmentStatus)}`}>
                        {shipmentStatusLabel(alert.shipmentStatus)}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${contactStatusBadge(alert.contactStatus)}`}>
                        {alert.contactStatus.replace(/-/g, " ")}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-4 text-[12px] text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <User className="w-3.5 h-3.5" />
                        {alert.recipientName || "Unknown"}
                      </span>
                      {alert.recipientPhone && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5" />
                          {alert.recipientPhone}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Truck className="w-3.5 h-3.5" />
                        {alert.driverName || "—"}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {alert.deliveryAddress || "Address pending"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <EtaBadge alertId={alert.id} initialEta={alert.etaMinutes} />
                      <span className="text-[10px] text-muted-foreground">
                        {fmtTime(alert.createdAt)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    {alert.recipientPhone && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px] font-bold"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`tel:${alert.recipientPhone}`, "_self");
                        }}
                        data-testid={`quick-call-${alert.id}`}
                      >
                        <Phone className="w-3 h-3 mr-1" />
                        Call
                      </Button>
                    )}
                    {alert.recipientPhone && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px] font-bold"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`https://wa.me/${alert.recipientPhone.replace(/[^0-9]/g, "")}`, "_blank");
                        }}
                        data-testid={`quick-whatsapp-${alert.id}`}
                      >
                        <MessageSquare className="w-3 h-3 mr-1" />
                        Text
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Delete alert for ${alert.waybill}?`)) {
                          deleteAlertMutation.mutate(alert.id);
                        }
                      }}
                      data-testid={`delete-alert-${alert.id}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>

      {/* Action Drawer */}
      <ActionDrawer
        alert={selectedAlert}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedAlert(null);
        }}
        onSubmitted={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/shipment-alerts"] });
        }}
      />
    </div>
  );
}
