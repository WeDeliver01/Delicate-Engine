import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useDriverAuth } from "@/hooks/use-driver-auth";
import { useDriverLocation } from "@/hooks/use-driver-location";
import { useDriverTrip } from "@/hooks/use-driver-trip";
import { usePullRefresh } from "@/hooks/use-pull-refresh";
import { performStopAction, submitReorderRequest, fetchReorderStatus, fetchReorderHistory, fetchRoutePolyline, fetchOnlineDrivers, startTrip, endTrip, logTripStop, logTripExpense, fetchDriverNotifications, markDriverNotificationRead, markAllDriverNotificationsRead, goOnlineWithRetry, declineOnline, EarlyDeliveryError, type ReorderRequest, type OnlineDriver, type DriverStop, type DriverInboxNotification } from "@/lib/driver-api";
import { gMap } from "@/lib/geo";
import { injectDriverManifest, setMobileViewportHeight } from "@/lib/driver-pwa";
import { DriverToastContainer, showDriverToast } from "@/components/driver/driver-toast";
import { motion, AnimatePresence } from "framer-motion";
import DriverMap from "@/components/driver/driver-map";
import ActiveStopCard from "@/components/driver/active-stop-card";
import StopCompletionModal from "@/components/driver/stop-completion-modal";
import UpcomingStopsList from "@/components/driver/upcoming-stops-list";
import ReorderModal from "@/components/driver/reorder-modal";
import StartShiftGate from "@/components/driver/start-shift-gate";
import EndShiftGate from "@/components/driver/end-shift-gate";
import StopEvidenceSheet from "@/components/driver/stop-evidence-sheet";
import LogFuelModal from "@/components/driver/log-fuel-modal";
import { useDriverTripSession } from "@/hooks/use-driver-trip-session";
import {
  Package, LogOut, Wifi, WifiOff, XCircle, SkipForward,
  CheckCircle2, AlertTriangle, Loader2, RefreshCw, ChevronUp,
  ChevronDown, Menu, Map as MapIcon, List, Navigation, ArrowUpDown, BarChart3,
  Clock, Users, ExternalLink, Settings, EyeOff, Battery, Volume2, Activity,
  Play, StopCircle, Fuel, Gauge, Power,
  Bell, Inbox, Truck, Route as RouteIcon,
} from "lucide-react";
import NativeDiagnostics from "@/components/driver/native-diagnostics";
import { isCapacitorNativeSync } from "@/lib/driver-native-location";
import { checkPushPermissionStatus, registerPushNotifications, unregisterPushNotifications, openNotificationSystemSettings, onDriverPushEvent, tapTargetFor, type PushPermissionStatus } from "@/lib/driver-push";
import { useLiveClock } from "@/hooks/use-live-clock";

type ViewMode = "map" | "list";

function inboxIconFor(kind: string) {
  switch (kind) {
    case "assignment_new": return Package;
    case "route_changed": return RouteIcon;
    case "stop_cancelled": return XCircle;
    case "reorder_approved": return CheckCircle2;
    case "reorder_rejected": return AlertTriangle;
    case "test": return Bell;
    default: return Bell;
  }
}

function inboxAccentFor(kind: string): string {
  switch (kind) {
    case "assignment_new": return "bg-jacaranda-500/20 text-jacaranda-300";
    case "route_changed": return "bg-amber-500/20 text-amber-300";
    case "stop_cancelled": return "bg-red-500/20 text-red-300";
    case "reorder_approved": return "bg-success/20 text-success";
    case "reorder_rejected": return "bg-red-500/20 text-red-300";
    default: return "bg-white/10 text-text-tertiary";
  }
}

function formatInboxTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function DriverDashboard() {
  const [, setLocation] = useLocation();
  const { driver, isAuthenticated, logout } = useDriverAuth();
  const [isOnline, setIsOnline] = useState(true);
  const [shiftGateBypassed, setShiftGateBypassed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("driver-shift-gate-bypassed") === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (shiftGateBypassed) window.localStorage.setItem("driver-shift-gate-bypassed", "1");
    else window.localStorage.removeItem("driver-shift-gate-bypassed");
  }, [shiftGateBypassed]);
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [showMenu, setShowMenu] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [modalTab, setModalTab] = useState<"complete" | "fail">("complete");
  const [actionLoading, setActionLoading] = useState(false);
  const [expandUpcoming, setExpandUpcoming] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showReorderModal, setShowReorderModal] = useState(false);
  const [reorderLoading, setReorderLoading] = useState(false);
  const [pendingReorder, setPendingReorder] = useState<ReorderRequest | null>(null);
  const [reorderHistory, setReorderHistory] = useState<ReorderRequest[]>([]);
  const [showReorderHistory, setShowReorderHistory] = useState(false);
  const [dismissedReorderId, setDismissedReorderId] = useState<number | null>(null);
  const [otherDrivers, setOtherDrivers] = useState<OnlineDriver[]>([]);
  const [showDriversPanel, setShowDriversPanel] = useState(false);
  const [inboxNotifications, setInboxNotifications] = useState<DriverInboxNotification[]>([]);
  const [inboxUnread, setInboxUnread] = useState(0);
  const [showInboxPanel, setShowInboxPanel] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [onlineRequest, setOnlineRequest] = useState<{ by?: string; notifId?: number } | null>(null);
  const [onlineRequestBusy, setOnlineRequestBusy] = useState(false);
  const handledOnlineRequestRef = useRef<number | null>(null);

  const { time, date } = useLiveClock();
  const { location, settings: trackingSettings, updateSettings: updateTrackingSettings, acknowledgeBackgroundWarning, setAutoOfflineCallback } = useDriverLocation(isOnline);

  const tripSession = useDriverTripSession(isAuthenticated);
  const [showStartGate, setShowStartGate] = useState(false);
  const [showEndGate, setShowEndGate] = useState(false);
  const [showFuelModal, setShowFuelModal] = useState(false);
  const [showEvidenceSheet, setShowEvidenceSheet] = useState(false);
  const [evidenceStop, setEvidenceStop] = useState<DriverStop | null>(null);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [fuelBusy, setFuelBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const isNative = isCapacitorNativeSync();
  const [pushStatus, setPushStatus] = useState<PushPermissionStatus | null>(null);
  const [pushBannerDismissed, setPushBannerDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem("delicate-driver-push-banner-dismissed") === "1"; } catch { return false; }
  });

  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    let lastStatus: PushPermissionStatus | null = null;

    const tick = async () => {
      try {
        const s = await checkPushPermissionStatus();
        if (cancelled) return;
        // Proactively remove the device's token from the server whenever
        // permission is denied — both on the *first* check (covers the case
        // where the user revoked notifications before re-launching the app)
        // and on transitions into denied (revoked while the dashboard is
        // open). unregisterPushNotifications is best-effort and idempotent.
        const transitionedToDenied = s === "denied" && lastStatus !== "denied";
        if (transitionedToDenied) {
          unregisterPushNotifications().catch(() => {});
        }
        lastStatus = s;
        setPushStatus(s);
      } catch {
        // ignore — leave status as-is
      }
    };

    tick();
    // Re-check whenever the app comes back to the foreground (e.g. after the
    // user toggled the system permission in Settings) and on a slow interval
    // as a safety net.
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(tick, 60000);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [isNative]);

  const {
    trip, loading, error, activeStop, upcomingStops, completedStops,
    etaMap, stopTimestamps, loadTrip, loadEtas, updateStopLocally,
  } = useDriverTrip(isOnline);

  useEffect(() => {
    setAutoOfflineCallback(() => {
      setIsOnline(false);
    });
  }, [setAutoOfflineCallback]);

  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOfflineHandler = () => setIsOffline(true);
    const goOnlineHandler = () => setIsOffline(false);
    window.addEventListener("offline", goOfflineHandler);
    window.addEventListener("online", goOnlineHandler);
    return () => {
      window.removeEventListener("offline", goOfflineHandler);
      window.removeEventListener("online", goOnlineHandler);
    };
  }, []);

  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    await loadTrip();
    await loadEtas();
    setPullRefreshing(false);
  }, [loadTrip, loadEtas]);

  const { containerRef: pullRefreshRef, pullDistance, refreshing: pullActive } = usePullRefresh({
    onRefresh: onPullRefresh,
  });

  useEffect(() => {
    if (!isAuthenticated) setLocation("/driver/login");
    injectDriverManifest();
    setMobileViewportHeight();
  }, [isAuthenticated, setLocation]);

  useEffect(() => {
    if (trip && trip.stopCount > 0) {
      const remaining = trip.stops.filter((s) => s.status === "pending" || s.status === "arrived");
      if (remaining.length === 0) {
        setLocation("/driver/summary");
      }
    }
  }, [trip, setLocation]);

  const progress = trip ? Math.round(((trip.completedCount) / Math.max(trip.stopCount, 1)) * 100) : 0;

  async function handlePullRefresh() {
    setPullRefreshing(true);
    await loadTrip();
    await loadEtas();
    checkReorderStatus();
    loadOtherDrivers();
    setPullRefreshing(false);
  }

  const checkReorderStatus = useCallback(async () => {
    try {
      const [status, history] = await Promise.all([fetchReorderStatus(), fetchReorderHistory()]);
      setPendingReorder((prev) => {
        if (prev?.status === "pending" && status?.status === "approved") {
          loadTrip();
          loadEtas();
        }
        return status;
      });
      setReorderHistory(history);
    } catch {}
  }, [loadTrip, loadEtas]);

  useEffect(() => {
    if (isAuthenticated && isOnline) {
      checkReorderStatus();
      const interval = setInterval(checkReorderStatus, 30000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, isOnline, checkReorderStatus]);

  const loadInbox = useCallback(async () => {
    setInboxLoading(true);
    try {
      const { notifications, unreadCount } = await fetchDriverNotifications(50);
      setInboxNotifications(notifications);
      setInboxUnread(unreadCount);
    } catch {
      // silent — inbox is best-effort
    } finally {
      setInboxLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const off = onDriverPushEvent((detail) => {
      // Server has already persisted the inbox row before sending the push.
      // Refresh the inbox immediately so the bell badge ticks up even when
      // the OS suppressed the banner (foreground delivery, DND, etc.).
      loadInbox();
      switch (detail.kind) {
        case "assignment_new":
        case "route_changed":
        case "stop_cancelled":
          loadTrip();
          loadEtas();
          return;
        case "reorder_approved":
        case "reorder_rejected":
          checkReorderStatus();
          loadTrip();
          loadEtas();
          return;
        case "online_request":
          // Dispatch is asking this driver to come online. Surface a confirm
          // prompt — going online is driver-consented, never forced silently.
          setOnlineRequest({ by: detail.data?.requestedBy });
          return;
        default:
          return;
      }
    });
    return off;
  }, [isAuthenticated, loadTrip, loadEtas, checkReorderStatus, loadInbox]);

  // Fallback path: the 30s inbox poll is the safety net when a push banner is
  // suppressed or FCM is unconfigured. If an unread online_request lands and the
  // driver isn't already online, surface the same confirm prompt once per request.
  useEffect(() => {
    if (isOnline) return;
    if (onlineRequest) return;
    const pending = inboxNotifications.find(
      (n) => n.kind === "online_request" && !n.readAt && n.id !== handledOnlineRequestRef.current,
    );
    if (pending) {
      handledOnlineRequestRef.current = pending.id;
      const by = (pending.data as Record<string, string> | undefined)?.requestedBy;
      setOnlineRequest({ by, notifId: pending.id });
    }
  }, [inboxNotifications, isOnline, onlineRequest]);

  // A push-delivered online_request carries no notification id, so resolve the
  // latest unread one from the inbox. Marking it handled (ref + read) stops the
  // 30s inbox poll fallback from resurfacing the same prompt in a loop.
  function markOnlineRequestHandled() {
    const notifId =
      onlineRequest?.notifId ??
      inboxNotifications.find((n) => n.kind === "online_request" && !n.readAt)?.id;
    if (notifId == null) return;
    handledOnlineRequestRef.current = notifId;
    markDriverNotificationRead(notifId).catch(() => {});
    setInboxNotifications((prev) =>
      prev.map((x) => (x.id === notifId ? { ...x, readAt: new Date().toISOString() } : x)),
    );
  }

  async function handleAcceptOnlineRequest() {
    setOnlineRequestBusy(true);
    markOnlineRequestHandled();
    // Bounded retry/backoff so a transient failure on the explicit go-online
    // call doesn't strand the driver offline server-side.
    const ok = await goOnlineWithRetry();
    // Flip isOnline regardless: the location hook then keeps re-attempting
    // go-online and its location pings also clear the pending ops request. If
    // the server never confirmed, surface it so the driver knows to retry.
    setIsOnline(true);
    setOnlineRequest(null);
    if (!ok) {
      showDriverToast("Couldn't confirm online with dispatch — retrying in the background.", "error");
    }
    setOnlineRequestBusy(false);
  }

  async function handleDeclineOnlineRequest() {
    setOnlineRequestBusy(true);
    markOnlineRequestHandled();
    try {
      await declineOnline();
    } catch {
      // best-effort; the request is already marked handled locally
    } finally {
      setOnlineRequest(null);
      setOnlineRequestBusy(false);
    }
  }

  const loadOtherDrivers = useCallback(async () => {
    try {
      const all = await fetchOnlineDrivers();
      const myId = driver?.id;
      setOtherDrivers(all.filter((d) => d.id !== myId && d.lat != null && d.lng != null));
    } catch {}
  }, [driver?.id]);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadInbox();
    const interval = setInterval(loadInbox, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, loadInbox]);

  async function handleInboxItemClick(n: DriverInboxNotification) {
    if (!n.readAt) {
      setInboxNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
      );
      setInboxUnread((c) => Math.max(0, c - 1));
      markDriverNotificationRead(n.id).catch(() => {});
    }
    setShowInboxPanel(false);
    const target = tapTargetFor(n.kind);
    if (target.startsWith("/driver/dashboard")) {
      // Already here — let the URL change so future code can react via query
      // params (e.g. focus=reorder), but don't do a hard navigation that
      // would reload the whole app.
      try { window.history.replaceState(null, "", target); } catch {}
      return;
    }
    setLocation(target);
  }

  async function handleMarkAllInboxRead() {
    if (inboxUnread === 0) return;
    setInboxNotifications((prev) =>
      prev.map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })),
    );
    setInboxUnread(0);
    try { await markAllDriverNotificationsRead(); } catch {}
  }

  useEffect(() => {
    if (isAuthenticated && isOnline) {
      loadOtherDrivers();
      const interval = setInterval(loadOtherDrivers, 15000);
      return () => clearInterval(interval);
    } else {
      setOtherDrivers([]);
    }
  }, [isAuthenticated, isOnline, loadOtherDrivers]);

  function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function handleReorderSubmit(proposedOrder: string[], reason: string) {
    setReorderLoading(true);
    try {
      await submitReorderRequest(proposedOrder, reason);
      showDriverToast("Reorder request sent to dispatch", "success");
      setShowReorderModal(false);
      checkReorderStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to submit request";
      showDriverToast(msg, "error");
    } finally {
      setReorderLoading(false);
    }
  }

  const [routePolyline, setRoutePolyline] = useState<[number, number][]>([]);
  const lastRouteKeyRef = useRef("");

  useEffect(() => {
    if (!trip) { setRoutePolyline([]); return; }
    const pending = trip.stops.filter((s) => s.status === "pending" || s.status === "arrived");
    const waypoints: { lat: number; lng: number }[] = [];
    if (location.lat != null && location.lng != null) {
      waypoints.push({ lat: location.lat, lng: location.lng });
    }
    pending.forEach((s) => {
      if (s.lat && s.lng) waypoints.push({ lat: s.lat, lng: s.lng });
    });
    if (waypoints.length < 2) { setRoutePolyline([]); return; }
    const routeKey = waypoints.map(w => `${w.lat.toFixed(3)},${w.lng.toFixed(3)}`).join("|");
    if (routeKey === lastRouteKeyRef.current) return;
    lastRouteKeyRef.current = routeKey;
    fetchRoutePolyline(waypoints).then((pts) => {
      if (pts.length > 0) setRoutePolyline(pts);
      else setRoutePolyline(waypoints.map(w => [w.lat, w.lng] as [number, number]));
    }).catch(() => {
      setRoutePolyline(waypoints.map(w => [w.lat, w.lng] as [number, number]));
    });
  }, [trip, location.lat, location.lng]);

  async function handleStopAction(waybill: string, action: "arrive" | "complete" | "fail" | "skip", data?: Record<string, unknown>) {
    setActionLoading(true);
    setActionError(null);
    try {
      const stopType: "pickup" | "delivery" = (activeStop?.type || "D") === "C" ? "pickup" : "delivery";
      await performStopAction(waybill, action, {
        ...data,
        stopType,
        lat: location.lat ?? undefined,
        lng: location.lng ?? undefined,
      });
      if (activeStop) {
        const statusMap: Record<string, string> = { arrive: "arrived", complete: "completed", fail: "failed", skip: "skipped" };
        const newStatus = statusMap[action] || action;
        updateStopLocally(activeStop.key, newStatus);
      }
      const toastMsgs: Record<string, string> = {
        arrive: "Arrived at stop",
        complete: "Stop marked complete",
        fail: "Stop marked as failed",
        skip: "Stop skipped",
      };
      showDriverToast(toastMsgs[action] || "Action recorded", action === "fail" ? "error" : "success");
      loadTrip();
      loadEtas();
    } catch (err) {
      // Early-delivery guard: confirm override and retry with force=true.
      if (err instanceof EarlyDeliveryError) {
        const ok = window.confirm(
          `${err.message}\n\nOnly proceed if dispatch has authorized an early delivery. Tap OK to override and complete the stop ${err.minutesEarly} min before the window opens.`
        );
        if (ok) {
          try {
            const stopType: "pickup" | "delivery" = (activeStop?.type || "D") === "C" ? "pickup" : "delivery";
            await performStopAction(waybill, action, {
              ...data,
              stopType,
              lat: location.lat ?? undefined,
              lng: location.lng ?? undefined,
              force: true,
            });
            if (activeStop) {
              const statusMap: Record<string, string> = { arrive: "arrived", complete: "completed", fail: "failed", skip: "skipped" };
              updateStopLocally(activeStop.key, statusMap[action] || action);
            }
            showDriverToast("Early delivery recorded (authorized override)", "success");
            loadTrip();
            loadEtas();
            return;
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : "Override failed";
            setActionError(retryMsg);
            showDriverToast(retryMsg, "error");
            return;
          }
        } else {
          showDriverToast(`Hold off — window opens at ${err.windowOpensAt}`, "error");
          return;
        }
      }
      const msg = err instanceof Error ? err.message : "Action failed. Please retry.";
      setActionError(msg);
      showDriverToast(msg, "error");
    } finally {
      setActionLoading(false);
    }
  }

  function handleArrive() {
    if (!activeStop) return;
    const wb = activeStop.wbs[0];
    if (!wb) return;
    if (tripSession.trip) {
      setEvidenceStop(activeStop);
      setShowEvidenceSheet(true);
    } else {
      handleStopAction(wb, "arrive");
    }
  }

  async function handleEvidenceSubmit(payload: { photoUrl: string | null; notes: string; lat: number | null; lng: number | null }) {
    if (!tripSession.trip || !evidenceStop) return;
    setEvidenceBusy(true);
    try {
      const stop = await logTripStop(tripSession.trip.id, {
        stopKey: evidenceStop.key,
        waybill: evidenceStop.wbs[0] || "",
        stopType: (evidenceStop.type || "D") === "C" ? "pickup" : "delivery",
        ...payload,
      });
      tripSession.addLocalStop(stop);
      showDriverToast("Stop evidence saved", "success");
      const wb = evidenceStop.wbs[0];
      setShowEvidenceSheet(false);
      setEvidenceStop(null);
      if (wb) await handleStopAction(wb, "arrive");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save evidence";
      showDriverToast(msg, "error");
    } finally {
      setEvidenceBusy(false);
    }
  }

  function handleEvidenceSkip() {
    const wb = evidenceStop?.wbs[0];
    setShowEvidenceSheet(false);
    setEvidenceStop(null);
    if (wb) handleStopAction(wb, "arrive");
  }

  async function handleStartShift(payload: {
    startOdometer: number;
    startFuelLevel: string;
    startClusterPhoto: string | null;
    startLat: number | null;
    startLng: number | null;
  }) {
    setShiftBusy(true);
    try {
      const t = await startTrip(payload);
      tripSession.setLocalTrip(t);
      await tripSession.refresh();
      showDriverToast("Shift started", "success");
      setShowStartGate(false);
      setShiftGateBypassed(false);
      if (!isOnline) setIsOnline(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start shift";
      showDriverToast(msg, "error");
    } finally {
      setShiftBusy(false);
    }
  }

  async function handleEndShift(payload: {
    endOdometer: number;
    endFuelLevel: string;
    endClusterPhoto: string | null;
    endLat: number | null;
    endLng: number | null;
    notes: string;
  }) {
    if (!tripSession.trip) return;
    setShiftBusy(true);
    try {
      const result = await endTrip(tripSession.trip.id, payload);
      try {
        sessionStorage.setItem("delicate-driver-last-trip-summary", JSON.stringify({
          tripId: result.trip.id,
          summary: result.summary,
          endedAt: new Date().toISOString(),
        }));
      } catch {}
      showDriverToast("Shift ended", "success");
      tripSession.clear();
      setShowEndGate(false);
      setIsOnline(false);
      setLocation("/driver/summary");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to end shift";
      showDriverToast(msg, "error");
    } finally {
      setShiftBusy(false);
    }
  }

  async function handleLogFuel(payload: { amount: number; litres: number | null; receiptUrl: string | null; notes: string; lat: number | null; lng: number | null }) {
    if (!tripSession.trip) return;
    setFuelBusy(true);
    try {
      const exp = await logTripExpense(tripSession.trip.id, { expenseType: "fuel", ...payload });
      tripSession.addLocalExpense(exp);
      showDriverToast("Fuel logged", "success");
      setShowFuelModal(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to log fuel";
      showDriverToast(msg, "error");
    } finally {
      setFuelBusy(false);
    }
  }

  function handleDutyToggle() {
    if (isOnline && tripSession.trip) {
      setShowEndGate(true);
      return;
    }
    if (isOnline) {
      setIsOnline(false);
      return;
    }
    if (!tripSession.trip) {
      setShowStartGate(true);
      return;
    }
    setIsOnline(true);
    loadTrip();
    loadEtas();
  }

  function handleCompleteClick() {
    setModalTab("complete");
    setShowCompleteModal(true);
  }

  function handleFailClick() {
    setModalTab("fail");
    setShowCompleteModal(true);
  }

  function handleCompleteConfirm(recipientName: string, notes: string, signature?: string | null) {
    if (!activeStop) return;
    const wb = activeStop.wbs[0];
    if (wb) handleStopAction(wb, "complete", { recipientName, notes, ...(signature ? { signature } : {}) });
    setShowCompleteModal(false);
  }

  function handleFail(notes: string) {
    if (!activeStop) return;
    const wb = activeStop.wbs[0];
    if (wb) handleStopAction(wb, "fail", { notes });
    setShowCompleteModal(false);
  }

  function handleSkip() {
    if (!activeStop) return;
    const wb = activeStop.wbs[0];
    if (wb) handleStopAction(wb, "skip");
  }

  if (!isAuthenticated) return null;

  const allStops = trip?.stops || [];
  const tripCheckPending = isOnline && !tripSession.trip && tripSession.loading;
  const requireStartGate = isOnline && !tripSession.trip && !tripSession.loading && !shiftGateBypassed;

  if (tripCheckPending) {
    return (
      <div className="flex flex-col driver-fullscreen items-center justify-center px-4" style={{ background: "hsl(var(--v7-surface-base))" }} data-testid="screen-trip-loading">
        <DriverToastContainer />
        <Loader2 className="w-8 h-8 text-jacaranda-400 animate-spin mb-3" />
        <p className="text-sm text-text-tertiary">Checking active shift…</p>
      </div>
    );
  }

  if (requireStartGate) {
    return (
      <div className="flex flex-col driver-fullscreen items-center justify-center px-4" style={{ background: "hsl(var(--v7-surface-base))" }} data-testid="screen-start-gate-required">
        <DriverToastContainer />
        <div className="max-w-sm w-full text-center mb-4">
          <Gauge className="w-12 h-12 text-jacaranda-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-text-primary mb-1">Start your shift</h2>
          <p className="text-sm text-text-tertiary">Capture the opening odometer, fuel level and a cluster photo before going online.</p>
        </div>
        <div className="flex flex-col items-center gap-3 mb-4">
          <button
            onClick={() => setShiftGateBypassed(true)}
            className="px-4 py-2 rounded-lg bg-jacaranda-500/20 border border-jacaranda-500/40 text-jacaranda-300 text-xs font-semibold hover:bg-jacaranda-500/30"
            data-testid="button-skip-shift-gate"
          >
            Skip for now and go online
          </button>
          <button
            onClick={() => setIsOnline(false)}
            className="text-xs text-text-quiet hover:text-text-secondary underline"
            data-testid="button-cancel-shift-gate"
          >
            Go offline instead
          </button>
        </div>
        <StartShiftGate
          open
          vehiclePlate={driver?.vehiclePlate || trip?.vehiclePlate || ""}
          vehicleType={driver?.vehicleType || ""}
          driverLat={location.lat ?? null}
          driverLng={location.lng ?? null}
          loading={shiftBusy}
          onClose={() => setIsOnline(false)}
          onStart={handleStartShift}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col driver-fullscreen" style={{ background: "hsl(var(--v7-surface-base))" }}>
      <DriverToastContainer />
      <header className="flex-shrink-0 flex flex-col px-3 sm:px-4" style={{ background: "hsl(var(--v7-surface-raised) / 0.95)", borderBottom: "1px solid hsl(var(--v7-border-hairline))", paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
        <div className="flex items-center justify-between gap-2 min-h-14">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button onClick={() => setShowMenu(!showMenu)} className="p-2 -ml-2 text-text-tertiary shrink-0" data-testid="button-menu">
              <Menu className="w-5 h-5" />
            </button>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-text-primary shrink-0 border-2 border-hairline" style={{ backgroundColor: trip?.fleetColor || "#4a9eff" }} data-testid="driver-color-dot">
              {(driver?.driverName || "D").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-sm font-semibold text-text-primary leading-tight truncate" data-testid="text-driver-name">{driver?.driverName || "Driver"}</h1>
              <div className="flex items-center gap-1.5 flex-wrap">
                {isOnline ? (
                  <><Wifi className="w-3 h-3 text-success shrink-0" /><span className="text-xs text-success">Online</span></>
                ) : (
                  <><WifiOff className="w-3 h-3 text-text-quiet shrink-0" /><span className="text-xs text-text-quiet">Offline</span></>
                )}
                {trip?.vehiclePlate && <span className="text-[10px] text-text-quiet truncate" data-testid="text-vehicle-plate">{trip.vehiclePlate}</span>}
                {location.gpsLost && <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            <button
              onClick={() => setViewMode(viewMode === "map" ? "list" : "map")}
              className="p-2 text-text-tertiary hover:text-white"
              data-testid="button-toggle-view"
              aria-label="Toggle map / list"
            >
              {viewMode === "map" ? <List className="w-5 h-5" /> : <MapIcon className="w-5 h-5" />}
            </button>
            <button
              onClick={() => { setShowInboxPanel((s) => !s); if (!showInboxPanel) loadInbox(); }}
              className="relative p-2 text-text-tertiary hover:text-white"
              data-testid="button-toggle-inbox"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              {inboxUnread > 0 && (
                <span
                  className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
                  data-testid="badge-inbox-unread"
                >
                  {inboxUnread > 99 ? "99+" : inboxUnread}
                </span>
              )}
            </button>
            <button
              onClick={handleDutyToggle}
              className={`px-2.5 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-medium whitespace-nowrap ${isOnline ? (tripSession.trip ? "bg-jacaranda-500/20 text-jacaranda-400" : "bg-success/20 text-success") : "bg-gray-500/20 text-text-tertiary"}`}
              data-testid="button-toggle-online"
            >
              {isOnline ? (tripSession.trip ? "END" : "ON DUTY") : "START"}
            </button>
          </div>
        </div>
        {tripSession.trip && (
          <div className="flex items-center justify-between gap-2 pb-1.5 -mt-0.5">
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-jacaranda-500/20 text-jacaranda-400 whitespace-nowrap"
              data-testid="pill-active-trip"
            >
              <Gauge className="w-3 h-3" /> Trip #{tripSession.trip.id}
              {tripSession.trip.startTime && (
                <span data-testid="text-trip-started" className="opacity-80">
                  · {new Date(tripSession.trip.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </span>
            <button
              onClick={() => setShowFuelModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold text-white shadow-md active:scale-95 whitespace-nowrap"
              style={{ background: "linear-gradient(90deg, #ef4444 0%, #2563eb 100%)" }}
              data-testid="button-quick-log-fuel"
            >
              <Fuel className="w-3.5 h-3.5" />
              Log Fuel
              {tripSession.fuelTotal > 0 && (
                <span className="ml-0.5 text-[10px] opacity-90">R{tripSession.fuelTotal.toFixed(0)}</span>
              )}
            </button>
          </div>
        )}
      </header>

      <AnimatePresence>
        {showInboxPanel && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-14 right-2 z-50 w-[min(380px,calc(100vw-1rem))] max-h-[70vh] overflow-y-auto rounded-xl shadow-2xl"
            style={{ background: "hsl(var(--v7-surface-raised) / 0.98)", border: "1px solid hsl(var(--v7-border-hairline))" }}
            data-testid="panel-inbox"
          >
            <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-white/10" style={{ background: "hsl(var(--v7-surface-raised) / 0.98)" }}>
              <div className="flex items-center gap-2">
                <Inbox className="w-4 h-4 text-jacaranda-400" />
                <span className="text-sm font-semibold text-white">Inbox</span>
                {inboxUnread > 0 && (
                  <span className="text-[10px] text-text-quiet">{inboxUnread} unread</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {inboxUnread > 0 && (
                  <button
                    onClick={handleMarkAllInboxRead}
                    className="text-[11px] text-jacaranda-300 hover:text-jacaranda-200"
                    data-testid="button-mark-all-read"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setShowInboxPanel(false)}
                  className="text-text-quiet hover:text-white"
                  data-testid="button-close-inbox"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="divide-y divide-white/5">
              {inboxLoading && inboxNotifications.length === 0 && (
                <div className="px-4 py-8 text-center text-text-quiet text-sm">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…
                </div>
              )}
              {!inboxLoading && inboxNotifications.length === 0 && (
                <div className="px-4 py-8 text-center text-text-quiet text-sm" data-testid="text-inbox-empty">
                  No notifications yet
                </div>
              )}
              {inboxNotifications.map((n) => {
                const isUnread = !n.readAt;
                const Icon = inboxIconFor(n.kind);
                const accent = inboxAccentFor(n.kind);
                return (
                  <button
                    key={n.id}
                    onClick={() => handleInboxItemClick(n)}
                    className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-white/5 ${isUnread ? "bg-white/[0.03]" : ""}`}
                    data-testid={`button-inbox-item-${n.id}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${accent}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className={`text-sm ${isUnread ? "text-white font-semibold" : "text-text-secondary"}`} data-testid={`text-inbox-title-${n.id}`}>
                          {n.title || n.kind}
                        </div>
                        {isUnread && <span className="w-2 h-2 rounded-full bg-jacaranda-400 mt-1.5 shrink-0" />}
                      </div>
                      {n.body && (
                        <div className="text-xs text-text-tertiary mt-0.5 line-clamp-2">{n.body}</div>
                      )}
                      <div className="text-[10px] text-text-quiet mt-1">{formatInboxTime(n.createdAt)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMenu && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-14 left-0 right-0 z-50 p-4 space-y-2"
            style={{ background: "hsl(var(--v7-surface-raised) / 0.98)", borderBottom: "1px solid hsl(var(--v7-border-hairline))" }}
          >
            <button
              onClick={() => { setLocation("/driver/route"); setShowMenu(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-text-secondary hover:bg-white/5"
              data-testid="link-route-overview"
            >
              <MapIcon className="w-5 h-5 text-jacaranda-400" />
              <span>Route Overview</span>
            </button>
            <button
              onClick={() => { setLocation("/driver/summary"); setShowMenu(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-text-secondary hover:bg-white/5"
              data-testid="link-trip-summary"
            >
              <Package className="w-5 h-5 text-jacaranda-400" />
              <span>Trip Summary</span>
            </button>
            <button
              onClick={() => { setLocation("/driver/analytics"); setShowMenu(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-text-secondary hover:bg-white/5"
              data-testid="link-my-performance"
            >
              <BarChart3 className="w-5 h-5 text-jacaranda-400" />
              <span>My Performance</span>
            </button>
            {tripSession.trip && (
              <button
                onClick={() => { setShowFuelModal(true); setShowMenu(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-text-secondary hover:bg-white/5"
                data-testid="link-log-fuel"
              >
                <Fuel className="w-5 h-5 text-jacaranda-400" />
                <span>Log Fuel</span>
                {tripSession.fuelTotal > 0 && (
                  <span className="ml-auto text-[11px] text-jacaranda-400 font-semibold">R{tripSession.fuelTotal.toFixed(0)}</span>
                )}
              </button>
            )}
            <button
              onClick={() => { setShowSettings(true); setShowMenu(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-text-secondary hover:bg-white/5"
              data-testid="link-tracking-settings"
            >
              <Settings className="w-5 h-5 text-jacaranda-400" />
              <span>Tracking Settings</span>
            </button>
            {isNative && (
              <button
                onClick={() => { setShowDiagnostics(true); setShowMenu(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-text-secondary hover:bg-white/5"
                data-testid="link-native-diagnostics"
              >
                <Activity className="w-5 h-5 text-jacaranda-400" />
                <span>Native Diagnostics</span>
              </button>
            )}
            <div className="border-t border-hairline pt-2 mt-2">
              <button
                onClick={() => { logout(); setShowMenu(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-red-400 hover:bg-red-500/10"
                data-testid="button-logout"
              >
                <LogOut className="w-5 h-5" />
                <span>Sign Out</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {location.tracking && isOnline && !location.isBackground && (
        <div className="flex-shrink-0 px-4 py-1.5 flex items-center gap-2" style={{ background: "hsl(var(--v7-jacaranda-500) / 0.12)", borderBottom: "1px solid hsl(var(--v7-jacaranda-500) / 0.2)" }}>
          <Navigation className="w-3 h-3 text-jacaranda-400 animate-pulse" />
          <span className="text-[11px] text-jacaranda-400">Delicate Driver is tracking your location</span>
        </div>
      )}

      {location.tracking && isOnline && location.isBackground && (
        <div
          className="flex-shrink-0 px-4 py-1.5 flex items-center gap-2"
          style={{ background: "hsl(var(--v7-warning) / 0.18)", borderBottom: "1px solid hsl(var(--v7-warning) / 0.32)" }}
          data-testid="banner-backgrounded"
        >
          <EyeOff className="w-3 h-3 text-amber-400" />
          <span className="text-[11px] text-amber-300">
            App is in the background — keep it open for the most reliable tracking.
            {trackingSettings.audioKeepAlive ? " Silent audio keep-alive is on." : ""}
          </span>
        </div>
      )}

      {location.tracking && isOnline && !location.isBackground && location.wasBackgrounded && (
        <div
          className="flex-shrink-0 px-4 py-1.5 flex items-center justify-between gap-2"
          style={{ background: "hsl(var(--v7-warning) / 0.14)", borderBottom: "1px solid hsl(var(--v7-warning) / 0.28)" }}
          data-testid="banner-was-backgrounded"
        >
          <div className="flex items-center gap-2 min-w-0">
            <EyeOff className="w-3 h-3 text-amber-400 flex-shrink-0" />
            <span className="text-[11px] text-amber-300 truncate">
              Tracking was reduced while the app was in the background. Live updates have resumed.
            </span>
          </div>
          <button
            type="button"
            onClick={acknowledgeBackgroundWarning}
            className="text-[11px] text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline flex-shrink-0"
            data-testid="button-dismiss-was-backgrounded"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex-shrink-0 px-4 py-2" style={{ background: "hsl(var(--v7-surface-raised) / 0.8)" }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-text-tertiary">{trip?.completedCount || 0} of {trip?.stopCount || 0} stops</span>
          <div className="flex items-center gap-2 text-right" data-testid="live-clock">
            <span className="text-[10px] text-text-quiet">{date}</span>
            <span className="text-xs font-mono font-semibold text-jacaranda-400 tabular-nums">{time}</span>
          </div>
        </div>
        <div className="w-full h-1.5 bg-surface-overlay/60 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, #4a9eff, #22c55e)" }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      {pendingReorder && pendingReorder.status === "pending" && (
        <div className="flex-shrink-0 px-4 py-2 flex items-center gap-2" style={{ background: "hsl(var(--v7-warning) / 0.14)", borderBottom: "1px solid hsl(var(--v7-warning) / 0.28)" }}>
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs text-amber-300">Reorder request pending dispatch approval</span>
        </div>
      )}

      {pendingReorder && pendingReorder.status === "approved" && dismissedReorderId !== pendingReorder.id && (
        <div className="flex-shrink-0 px-4 py-2 flex items-center justify-between gap-2" style={{ background: "hsl(var(--v7-success) / 0.14)", borderBottom: "1px solid hsl(var(--v7-success) / 0.28)" }}>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
            <span className="text-xs text-green-300">Reorder approved — your route has been updated</span>
          </div>
          <button onClick={() => setDismissedReorderId(pendingReorder.id)} className="text-green-400 text-[10px]">Dismiss</button>
        </div>
      )}

      {pendingReorder && pendingReorder.status === "rejected" && dismissedReorderId !== pendingReorder.id && (
        <div className="flex-shrink-0 px-4 py-2 flex items-center justify-between gap-2" style={{ background: "hsl(var(--v7-danger) / 0.14)", borderBottom: "1px solid hsl(var(--v7-danger) / 0.28)" }}>
          <div className="flex items-center gap-2">
            <XCircle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-xs text-red-300">Reorder request declined{pendingReorder.reviewNote ? `: ${pendingReorder.reviewNote}` : ""}</span>
          </div>
          <button onClick={() => setDismissedReorderId(pendingReorder.id)} className="text-red-400 text-[10px]">Dismiss</button>
        </div>
      )}

      {actionError && (
        <div className="flex-shrink-0 px-4 py-2 bg-red-500/20 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-xs text-red-300">{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-red-400 text-xs font-medium">Dismiss</button>
        </div>
      )}

      {location.gpsLost && (
        <div className="flex-shrink-0 px-4 py-2 bg-amber-500/20 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="text-xs text-amber-300">GPS signal lost. Move to an open area.</span>
        </div>
      )}

      {isOffline && (
        <div className="flex-shrink-0 px-4 py-2 bg-red-500/20 flex items-center gap-2">
          <WifiOff className="w-4 h-4 text-red-400" />
          <span className="text-xs text-red-300">
            {trip ? "You're offline — showing cached data" : "No internet connection. Data will sync when reconnected."}
          </span>
        </div>
      )}

      {isNative && !pushBannerDismissed && (pushStatus === "denied" || pushStatus === "prompt") && (
        <div className="flex-shrink-0 px-4 py-2 bg-amber-500/15 flex items-center gap-2" data-testid="banner-push-permission">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="flex-1 text-xs text-amber-300">
            {pushStatus === "denied"
              ? "Notifications are off — you'll miss new assignments. Enable them in Settings."
              : "Turn on notifications to be alerted about new stops and route changes."}
          </span>
          {pushStatus === "prompt" && (
            <button
              data-testid="button-push-enable"
              onClick={async () => {
                const r = await registerPushNotifications();
                setPushStatus(r);
              }}
              className="text-xs px-2 py-1 rounded bg-amber-500/30 text-amber-100 hover:bg-amber-500/40"
            >
              Enable
            </button>
          )}
          {pushStatus === "denied" && (
            <button
              data-testid="button-push-open-settings"
              onClick={async () => {
                const opened = await openNotificationSystemSettings();
                if (opened) {
                  setTimeout(async () => {
                    const s = await checkPushPermissionStatus();
                    setPushStatus(s);
                  }, 1500);
                }
              }}
              className="text-xs px-2 py-1 rounded bg-amber-500/30 text-amber-100 hover:bg-amber-500/40"
            >
              Open Settings
            </button>
          )}
          <button
            data-testid="button-push-dismiss"
            onClick={() => {
              try { localStorage.setItem("delicate-driver-push-banner-dismissed", "1"); } catch {}
              setPushBannerDismissed(true);
            }}
            className="text-xs text-amber-300/70 hover:text-amber-200"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {pullRefreshing && (
        <div className="flex-shrink-0 px-4 py-2 flex items-center justify-center gap-2" style={{ background: "hsl(var(--v7-jacaranda-500) / 0.12)" }}>
          <Loader2 className="w-4 h-4 text-jacaranda-400 animate-spin" />
          <span className="text-xs text-jacaranda-400">Refreshing...</span>
        </div>
      )}

      {loading && !trip ? (
        <div className="flex-1 px-4 py-3 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl p-4 animate-pulse" style={{ background: "hsl(var(--v7-surface-overlay) / 0.5)" }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg bg-surface-overlay/60" />
                <div className="flex-1">
                  <div className="h-3 w-24 bg-surface-overlay/60 rounded mb-2" />
                  <div className="h-4 w-48 bg-surface-overlay/60 rounded" />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="h-3 w-16 bg-surface-overlay/60 rounded" />
                <div className="h-3 w-16 bg-surface-overlay/60 rounded" />
                <div className="h-3 w-16 bg-surface-overlay/60 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : error && !trip ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
          <AlertTriangle className="w-10 h-10 text-amber-400" />
          <p className="text-text-tertiary text-center text-sm">{error}</p>
          <button onClick={loadTrip} className="px-4 py-2 rounded-lg bg-jacaranda-500 text-text-primary text-sm" data-testid="button-retry">
            <RefreshCw className="w-4 h-4 inline mr-1" /> Retry
          </button>
        </div>
      ) : trip && trip.stopCount === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
          <Package className="w-12 h-12 text-text-quiet/70" />
          <p className="text-text-tertiary text-center">No stops assigned for today.</p>
          <button onClick={loadTrip} className="px-4 py-2 rounded-lg border border-hairline text-text-secondary text-sm" data-testid="button-refresh">
            <RefreshCw className="w-4 h-4 inline mr-1" /> Refresh
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {viewMode === "map" ? (
            <>
              <div className="relative" style={{ height: "35vh", minHeight: "180px", flexShrink: 0 }}>
                <DriverMap
                  driverLat={location.lat}
                  driverLng={location.lng}
                  stops={allStops}
                  activeStopKey={activeStop?.key || null}
                  routePolyline={routePolyline}
                  otherDrivers={otherDrivers}
                  selfColor={trip?.fleetColor}
                />
                <div className="absolute top-3 right-3 flex gap-2 z-[1000]">
                  <button
                    onClick={() => setShowDriversPanel(!showDriversPanel)}
                    className={`relative p-2 rounded-full text-text-primary ${showDriversPanel ? "bg-jacaranda-500" : "bg-black/50"}`}
                    data-testid="button-toggle-drivers-panel"
                  >
                    <Users className="w-4 h-4" />
                    {otherDrivers.length > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-success text-[9px] font-bold flex items-center justify-center">{otherDrivers.length}</span>
                    )}
                  </button>
                  <button
                    onClick={handlePullRefresh}
                    disabled={pullRefreshing}
                    className="p-2 rounded-full bg-black/50 text-text-primary"
                    data-testid="button-refresh-map"
                  >
                    <RefreshCw className={`w-4 h-4 ${pullRefreshing ? "animate-spin" : ""}`} />
                  </button>
                </div>
                <AnimatePresence>
                  {showDriversPanel && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute top-14 right-3 z-[1000] rounded-xl overflow-hidden shadow-lg"
                      style={{ background: "hsl(var(--v7-surface-raised) / 0.95)", border: "1px solid hsl(var(--v7-border-hairline))", width: 240, maxHeight: 220 }}
                      data-testid="drivers-panel"
                    >
                      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: "1px solid hsl(var(--v7-border-hairline) / 0.8)" }}>
                        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Online Drivers ({otherDrivers.length})</span>
                        <button onClick={() => setShowDriversPanel(false)} className="text-text-quiet hover:text-white">
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="overflow-y-auto" style={{ maxHeight: 180 }}>
                        {otherDrivers.length === 0 ? (
                          <div className="px-3 py-4 text-center text-xs text-text-quiet">No other drivers online</div>
                        ) : (
                          otherDrivers.map((od) => {
                            const dist = (location.lat != null && location.lng != null && od.lat != null && od.lng != null)
                              ? haversineDistance(location.lat, location.lng, od.lat, od.lng)
                              : null;
                            return (
                              <div key={od.id} className="px-3 py-2 flex items-center gap-2 hover:bg-white/5" style={{ borderBottom: "1px solid hsl(var(--v7-border-hairline) / 0.5)" }} data-testid={`drivers-panel-item-${od.id}`}>
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-text-primary flex-shrink-0" style={{ backgroundColor: /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(od.fleetColor) ? od.fleetColor : "#4a9eff" }}>
                                  {(od.driverName || "?").charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-text-primary font-medium truncate">{od.driverName}</p>
                                  <div className="flex items-center gap-1.5">
                                    {od.vehiclePlate && <span className="text-[10px] text-text-quiet">{od.vehiclePlate}</span>}
                                    {dist != null && <span className="text-[10px] text-jacaranda-400">{dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`}</span>}
                                  </div>
                                </div>
                                {od.lat != null && od.lng != null && (
                                  <a
                                    href={gMap(od.lat, od.lng)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1.5 rounded-lg bg-jacaranda-500/20 text-jacaranda-400 hover:bg-[#4a9eff]/30 flex-shrink-0"
                                    data-testid={`button-navigate-panel-${od.id}`}
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="flex-1 overflow-y-auto" style={{ background: "hsl(var(--v7-surface-base))" }}>
                {activeStop && (
                  <ActiveStopCard
                    stop={activeStop}
                    eta={etaMap.get(activeStop.key)}
                    actionLoading={actionLoading}
                    onArrive={handleArrive}
                    onComplete={handleCompleteClick}
                    onFail={handleFailClick}
                    onSkip={handleSkip}
                  />
                )}
                {upcomingStops.length > 0 && (
                  <div className="px-4 pb-4">
                    <div className="flex items-center justify-between py-2">
                      <button
                        onClick={() => setExpandUpcoming(!expandUpcoming)}
                        className="flex items-center gap-1"
                        data-testid="button-toggle-upcoming"
                      >
                        <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                          Upcoming ({upcomingStops.length})
                        </span>
                        {expandUpcoming ? <ChevronUp className="w-4 h-4 text-text-quiet" /> : <ChevronDown className="w-4 h-4 text-text-quiet" />}
                      </button>
                      {upcomingStops.length >= 2 && (!pendingReorder || pendingReorder.status !== "pending") && (
                        <button
                          onClick={() => setShowReorderModal(true)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-jacaranda-400 hover:bg-[#4a9eff]/10"
                          data-testid="button-request-reorder"
                        >
                          <ArrowUpDown className="w-3 h-3" />
                          Reorder
                        </button>
                      )}
                    </div>
                    <AnimatePresence>
                      {expandUpcoming && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                        >
                          <UpcomingStopsList stops={upcomingStops} etaMap={etaMap} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
                {completedStops.length > 0 && (
                  <div className="px-4 pb-3 opacity-60">
                    <p className="text-[10px] font-medium text-text-quiet uppercase tracking-wider mb-1">Done ({completedStops.length})</p>
                    {completedStops.map((s) => (
                      <div key={s.key} className="flex items-center gap-2 py-1 text-xs text-text-quiet" data-testid={`map-stop-done-${s.key}`}>
                        {s.status === "completed" ? <CheckCircle2 className="w-3 h-3" /> : s.status === "failed" ? <XCircle className="w-3 h-3" /> : <SkipForward className="w-3 h-3" />}
                        <span className="truncate flex-1">{s.addr || `${s.sub}, ${s.city}`}</span>
                        {stopTimestamps.get(s.key) && <span className="text-[9px] text-text-quiet/70">{stopTimestamps.get(s.key)}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div ref={pullRefreshRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 relative">
              {(pullDistance > 0 || pullActive) && (
                <div className="flex items-center justify-center py-2 transition-all" style={{ height: pullDistance > 0 ? pullDistance : 40 }}>
                  <RefreshCw className={`w-5 h-5 text-jacaranda-400 ${pullActive ? "animate-spin" : ""}`} style={{ transform: `rotate(${pullDistance * 3}deg)`, opacity: Math.min(pullDistance / 80, 1) }} />
                </div>
              )}
              {activeStop && (
                <ActiveStopCard
                  stop={activeStop}
                  eta={etaMap.get(activeStop.key)}
                  actionLoading={actionLoading}
                  onArrive={handleArrive}
                  onComplete={handleCompleteClick}
                  onFail={handleFailClick}
                  onSkip={handleSkip}
                />
              )}
              {upcomingStops.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider">Upcoming ({upcomingStops.length})</h3>
                    {upcomingStops.length >= 2 && (!pendingReorder || pendingReorder.status !== "pending") && (
                      <button
                        onClick={() => setShowReorderModal(true)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-jacaranda-400 hover:bg-[#4a9eff]/10"
                        data-testid="button-request-reorder-list"
                      >
                        <ArrowUpDown className="w-3 h-3" />
                        Reorder
                      </button>
                    )}
                  </div>
                  <UpcomingStopsList stops={upcomingStops} etaMap={etaMap} />
                </div>
              )}
              {completedStops.length > 0 && (
                <div className="opacity-60">
                  <h3 className="text-xs font-medium text-text-quiet uppercase tracking-wider mb-2">Done ({completedStops.length})</h3>
                  <div className="space-y-1.5">
                    {completedStops.map((s) => (
                      <div key={s.key} className="rounded-lg p-3 flex items-center gap-3" style={{ background: "hsl(var(--v7-surface-overlay) / 0.3)", border: "1px solid rgba(255,255,255,0.04)" }} data-testid={`stop-done-${s.key}`}>
                        {s.status === "completed" ? (
                          <CheckCircle2 className="w-4 h-4 text-text-quiet flex-shrink-0" />
                        ) : s.status === "failed" ? (
                          <XCircle className="w-4 h-4 text-text-quiet flex-shrink-0" />
                        ) : (
                          <SkipForward className="w-4 h-4 text-text-quiet flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-text-quiet truncate">{s.addr || `${s.sub}, ${s.city}`}</p>
                          <p className="text-[10px] text-text-quiet/70">{s.wbs.join(", ")}</p>
                        </div>
                        <div className="flex flex-col items-end flex-shrink-0">
                          <span className="text-[10px] text-text-quiet/70">
                            {s.status === "completed" ? "✓" : s.status === "failed" ? "✗" : "↷"}
                          </span>
                          {stopTimestamps.get(s.key) && (
                            <span className="text-[9px] text-text-quiet/70">{stopTimestamps.get(s.key)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {reorderHistory.length > 0 && (
                <div>
                  <button onClick={() => setShowReorderHistory(!showReorderHistory)} className="flex items-center gap-1.5 text-xs font-medium text-text-quiet uppercase tracking-wider mb-2" data-testid="button-toggle-driver-reorder-history">
                    <ArrowUpDown className="w-3 h-3" />
                    Reorder History ({reorderHistory.length})
                    {showReorderHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                  <AnimatePresence>
                    {showReorderHistory && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-1.5 overflow-hidden">
                        {reorderHistory.map((r: any) => (
                          <div key={r.id} className="rounded-lg p-2.5 flex items-center justify-between" style={{ background: "hsl(var(--v7-surface-overlay) / 0.4)", border: "1px solid hsl(var(--v7-border-hairline) / 0.7)" }} data-testid={`driver-reorder-history-${r.id}`}>
                            <div className="flex items-center gap-2">
                              {r.status === "approved" && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                              {r.status === "rejected" && <XCircle className="w-3.5 h-3.5 text-red-500" />}
                              {r.status === "pending" && <Clock className="w-3.5 h-3.5 text-amber-500" />}
                              {r.status === "expired" && <AlertTriangle className="w-3.5 h-3.5 text-text-quiet" />}
                              <span className={`text-[11px] font-medium ${r.status === "approved" ? "text-green-400" : r.status === "rejected" ? "text-red-400" : r.status === "pending" ? "text-amber-400" : "text-text-quiet"}`}>
                                {r.status === "approved" ? "Approved" : r.status === "rejected" ? "Declined" : r.status === "pending" ? "Pending" : "Expired"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-text-quiet">
                              {r.reviewNote && <span className="italic max-w-[100px] truncate">{r.reviewNote}</span>}
                              <span>{new Date(r.createdAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <StopCompletionModal
        open={showCompleteModal}
        stop={activeStop}
        initialTab={modalTab}
        onClose={() => setShowCompleteModal(false)}
        onComplete={handleCompleteConfirm}
        onFail={handleFail}
        loading={actionLoading}
      />

      <ReorderModal
        open={showReorderModal}
        stops={upcomingStops}
        onClose={() => setShowReorderModal(false)}
        onSubmit={handleReorderSubmit}
        loading={reorderLoading}
      />

      <StartShiftGate
        open={showStartGate}
        vehiclePlate={driver?.vehiclePlate || trip?.vehiclePlate || ""}
        vehicleType={driver?.vehicleType || ""}
        driverLat={location.lat ?? null}
        driverLng={location.lng ?? null}
        loading={shiftBusy}
        onClose={() => setShowStartGate(false)}
        onStart={handleStartShift}
      />

      <EndShiftGate
        open={showEndGate}
        startOdometer={tripSession.trip?.startOdometer ?? 0}
        driverLat={location.lat ?? null}
        driverLng={location.lng ?? null}
        loading={shiftBusy}
        onClose={() => setShowEndGate(false)}
        onEnd={handleEndShift}
      />

      <StopEvidenceSheet
        open={showEvidenceSheet}
        stop={evidenceStop}
        driverLat={location.lat ?? null}
        driverLng={location.lng ?? null}
        loading={evidenceBusy}
        onClose={handleEvidenceSkip}
        onSubmit={handleEvidenceSubmit}
        onSkip={handleEvidenceSkip}
      />

      <LogFuelModal
        open={showFuelModal}
        driverLat={location.lat ?? null}
        driverLng={location.lng ?? null}
        loading={fuelBusy}
        onClose={() => setShowFuelModal(false)}
        onSubmit={handleLogFuel}
      />

      {showDiagnostics && (
        <NativeDiagnostics location={location} onClose={() => setShowDiagnostics(false)} />
      )}

      {showSettings && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-3"
          onClick={() => setShowSettings(false)}
          data-testid="modal-tracking-settings"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-hairline overflow-hidden"
            style={{ background: "hsl(var(--v7-surface-raised))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-hairline flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-jacaranda-400" />
                <h3 className="text-sm font-semibold text-text-primary">Tracking Settings</h3>
              </div>
              <button onClick={() => setShowSettings(false)} className="text-text-tertiary hover:text-white p-1" data-testid="button-close-settings">
                <XCircle className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-5">
              <label className="flex items-start gap-3 cursor-pointer" data-testid="toggle-battery-saver-label">
                <div className="mt-0.5">
                  <Battery className="w-5 h-5 text-jacaranda-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-text-primary">Battery Saver</span>
                    <input
                      type="checkbox"
                      checked={trackingSettings.batterySaver}
                      onChange={(e) => updateTrackingSettings({ batterySaver: e.target.checked })}
                      className="w-10 h-6 accent-jacaranda-400"
                      data-testid="input-battery-saver"
                    />
                  </div>
                  <p className="text-xs text-text-tertiary mt-1">
                    Forces low-accuracy GPS and uploads every 2 minutes (instead of every 15 s while moving / 1 min while parked). Saves battery on long shifts but the dispatcher map updates less often.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer" data-testid="toggle-audio-keepalive-label">
                <div className="mt-0.5">
                  <Volume2 className="w-5 h-5 text-jacaranda-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-text-primary">iOS Audio Keep-Alive</span>
                    <input
                      type="checkbox"
                      checked={trackingSettings.audioKeepAlive}
                      onChange={(e) => updateTrackingSettings({ audioKeepAlive: e.target.checked })}
                      className="w-10 h-6 accent-jacaranda-400"
                      data-testid="input-audio-keepalive"
                    />
                  </div>
                  <p className="text-xs text-text-tertiary mt-1">
                    Plays a near-silent audio loop while you're on duty so iPhones keep the page running in the background. Drains a little extra battery but keeps your dot live on the dispatcher map.
                  </p>
                </div>
              </label>

              <div className="text-[11px] text-text-quiet leading-relaxed border-t border-hairline pt-4">
                These settings help — but no web app can fully replace a native background service. For the most reliable tracking, keep the app open and the screen on.
              </div>
            </div>
          </div>
        </div>
      )}

      {onlineRequest && (
        <div
          className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-3"
          data-testid="modal-online-request"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-hairline overflow-hidden"
            style={{ background: "hsl(var(--v7-surface-raised))" }}
          >
            <div className="px-5 py-4 border-b border-hairline flex items-center gap-2">
              <Power className="w-4 h-4 text-jacaranda-400" />
              <h3 className="text-sm font-semibold text-text-primary">Dispatch needs you online</h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-text-secondary" data-testid="text-online-request-body">
                {onlineRequest.by ? `${onlineRequest.by} is` : "Dispatch is"} asking you to go online so your
                location and stops are tracked. Go online now?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleDeclineOnlineRequest}
                  disabled={onlineRequestBusy}
                  className="flex-1 rounded-xl border border-hairline py-2.5 text-sm font-medium text-text-secondary hover:text-white disabled:opacity-50"
                  data-testid="button-decline-online-request"
                >
                  Not now
                </button>
                <button
                  onClick={handleAcceptOnlineRequest}
                  disabled={onlineRequestBusy}
                  className="flex-1 rounded-xl bg-jacaranda-500 py-2.5 text-sm font-semibold text-white hover:bg-jacaranda-400 disabled:opacity-50"
                  data-testid="button-accept-online-request"
                >
                  {onlineRequestBusy ? "Going online…" : "Go online"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
