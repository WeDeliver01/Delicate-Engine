import { useEffect, useState } from "react";
import { Activity, Battery, MapPin, ShieldCheck, ShieldAlert, X, Settings as SettingsIcon } from "lucide-react";
import type { LocationState } from "@/hooks/use-driver-location";
import { isCapacitorNativeSync, openNativeLocationSettings } from "@/lib/driver-native-location";

interface NativeDiagnosticsProps {
  location: LocationState;
  onClose: () => void;
}

interface BatteryInfo {
  level: number | null;
  charging: boolean | null;
  saver: boolean | null;
}

export default function NativeDiagnostics({ location, onClose }: NativeDiagnosticsProps) {
  const [battery, setBattery] = useState<BatteryInfo>({ level: null, charging: null, saver: null });
  const [queueDepth, setQueueDepth] = useState<number | null>(null);

  useEffect(() => {
    const nav = navigator as any;
    if (nav.getBattery) {
      nav.getBattery().then((b: any) => {
        const update = () => setBattery({
          level: b.level != null ? Math.round(b.level * 100) : null,
          charging: !!b.charging,
          saver: null,
        });
        update();
        b.addEventListener?.("levelchange", update);
        b.addEventListener?.("chargingchange", update);
      }).catch(() => {});
    }
    let cancelled = false;
    const refreshQueue = async () => {
      try {
        const reg = await navigator.serviceWorker?.ready;
        if (!reg) return;
        const channel = new MessageChannel();
        const ack = new Promise<number>((resolve) => {
          const t = setTimeout(() => resolve(-1), 1500);
          channel.port1.onmessage = (ev) => {
            clearTimeout(t);
            resolve(typeof ev.data?.depth === "number" ? ev.data.depth : -1);
          };
        });
        reg.active?.postMessage({ type: "queue-depth" }, [channel.port2]);
        const depth = await ack;
        if (!cancelled) setQueueDepth(depth >= 0 ? depth : null);
      } catch {}
    };
    refreshQueue();
    const interval = setInterval(refreshQueue, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const native = isCapacitorNativeSync();
  const lastFix = location.lastUpdate ? new Date(location.lastUpdate) : null;
  const ageSec = lastFix ? Math.round((Date.now() - lastFix.getTime()) / 1000) : null;

  const permissionLabel = location.permission === "granted" ? "Granted (Always)"
    : location.permission === "denied" ? "Denied"
    : location.permission === "prompt" ? "Not yet requested"
    : "Unknown";
  const permissionGood = location.permission === "granted";

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[1100] rounded-t-2xl p-4 max-h-[80vh] overflow-y-auto"
      style={{
        background: "hsl(var(--v7-surface-raised) / 0.98)",
        borderTop: "1px solid hsl(var(--v7-border-hairline))",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
      }}
      data-testid="panel-native-diagnostics"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-jacaranda-400" />
          <h3 className="text-sm font-semibold text-text-primary">Native Diagnostics</h3>
        </div>
        <button onClick={onClose} className="p-1 text-text-tertiary" data-testid="button-diagnostics-close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3 text-xs">
        <DiagRow
          icon={native ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : <ShieldAlert className="w-4 h-4 text-amber-400" />}
          label="Runtime"
          value={native ? "Native (Capacitor)" : "Web browser"}
          tone={native ? "good" : "warn"}
          testId="diag-runtime"
        />
        <DiagRow
          icon={permissionGood ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : <ShieldAlert className="w-4 h-4 text-amber-400" />}
          label="Location permission"
          value={permissionLabel}
          tone={permissionGood ? "good" : "warn"}
          testId="diag-permission"
        />
        <DiagRow
          icon={<MapPin className="w-4 h-4 text-jacaranda-400" />}
          label="Last GPS fix"
          value={lastFix ? `${ageSec}s ago — ±${Math.round(location.accuracy ?? 0)}m` : "No fix yet"}
          tone={ageSec != null && ageSec < 60 ? "good" : ageSec != null && ageSec < 300 ? "warn" : "bad"}
          testId="diag-last-fix"
        />
        <DiagRow
          icon={<Activity className="w-4 h-4 text-jacaranda-400" />}
          label="Queue depth"
          value={queueDepth == null ? "Unavailable" : `${queueDepth} pending`}
          tone={queueDepth == null ? "neutral" : queueDepth === 0 ? "good" : queueDepth < 10 ? "warn" : "bad"}
          testId="diag-queue-depth"
        />
        <DiagRow
          icon={<Battery className="w-4 h-4 text-jacaranda-400" />}
          label="Battery"
          value={battery.level != null ? `${battery.level}%${battery.charging ? " (charging)" : ""}` : "Unavailable"}
          tone={battery.level == null ? "neutral" : battery.level > 30 ? "good" : "warn"}
          testId="diag-battery"
        />
        {location.error && (
          <div className="text-amber-300 text-[11px] p-2 rounded-lg bg-amber-500/10 border border-amber-500/20" data-testid="diag-error">
            {location.error}
          </div>
        )}
      </div>

      {native && (
        <button
          onClick={() => openNativeLocationSettings()}
          className="w-full mt-4 h-10 rounded-lg border border-hairline text-text-secondary text-xs flex items-center justify-center gap-2"
          data-testid="button-open-settings"
        >
          <SettingsIcon className="w-3.5 h-3.5" />
          Open OS Location Settings
        </button>
      )}
    </div>
  );
}

function DiagRow({ icon, label, value, tone, testId }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "neutral";
  testId: string;
}) {
  const valueClass = tone === "good" ? "text-emerald-400"
    : tone === "warn" ? "text-amber-300"
    : tone === "bad" ? "text-red-400"
    : "text-text-secondary";
  return (
    <div className="flex items-center justify-between gap-3" data-testid={testId}>
      <div className="flex items-center gap-2 text-text-tertiary">
        {icon}
        <span>{label}</span>
      </div>
      <span className={`font-mono text-[11px] ${valueClass}`}>{value}</span>
    </div>
  );
}
