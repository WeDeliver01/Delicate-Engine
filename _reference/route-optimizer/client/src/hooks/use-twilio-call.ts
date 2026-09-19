import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

type CallStatus = "idle" | "connecting" | "ringing" | "in-progress" | "completed" | "failed";

let deviceInstance: any = null;
let deviceReady = false;
let deviceInitializing = false;
let activeCallGlobal: any = null;
let callStatusListeners = new Set<(s: CallStatus) => void>();
let callDurationListeners = new Set<(d: number) => void>();
let callErrorListeners = new Set<(e: string | null) => void>();
let durationTimer: ReturnType<typeof setInterval> | null = null;
let durationCounter = 0;

function broadcastStatus(s: CallStatus) {
  callStatusListeners.forEach((fn) => fn(s));
}
function broadcastDuration(d: number) {
  callDurationListeners.forEach((fn) => fn(d));
}
function broadcastError(e: string | null) {
  callErrorListeners.forEach((fn) => fn(e));
}

function clearDurationTimer() {
  if (durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }
}

export function destroyTwilioDevice() {
  if (activeCallGlobal) {
    try { activeCallGlobal.disconnect(); } catch (_) {}
    activeCallGlobal = null;
  }
  clearDurationTimer();
  if (deviceInstance) {
    try { deviceInstance.unregister(); } catch (_) {}
    try { deviceInstance.destroy(); } catch (_) {}
    deviceInstance = null;
  }
  deviceReady = false;
  deviceInitializing = false;
  broadcastStatus("idle");
}

export function useTwilioCall() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  const { data: twilioStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/twilio/status"],
    staleTime: 60000,
  });

  const isConfigured = twilioStatus?.configured ?? false;

  useEffect(() => {
    callStatusListeners.add(setStatus);
    callDurationListeners.add(setDuration);
    callErrorListeners.add(setError);
    return () => {
      callStatusListeners.delete(setStatus);
      callDurationListeners.delete(setDuration);
      callErrorListeners.delete(setError);
    };
  }, []);

  const ensureDevice = useCallback(async () => {
    if (deviceReady && deviceInstance) return deviceInstance;
    if (deviceInitializing) {
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (deviceReady || !deviceInitializing) {
            clearInterval(check);
            resolve();
          }
        }, 100);
      });
      return deviceInstance;
    }

    deviceInitializing = true;
    try {
      const { Device } = await import("@twilio/voice-sdk");

      const res = await apiRequest("POST", "/api/twilio/token");
      const { token } = await res.json();

      const device = new Device(token, {
        codecPreferences: ["opus" as any, "pcmu" as any],
        enableRingingState: true,
      });

      await device.register();

      device.on("tokenWillExpire", async () => {
        try {
          const refreshRes = await apiRequest("POST", "/api/twilio/token");
          const { token: newToken } = await refreshRes.json();
          device.updateToken(newToken);
        } catch (err) {
          console.error("[Twilio] Token refresh failed:", err);
        }
      });

      deviceInstance = device;
      deviceReady = true;
      return device;
    } catch (err: any) {
      console.error("[Twilio] Device init failed:", err);
      throw err;
    } finally {
      deviceInitializing = false;
    }
  }, []);

  const makeCall = useCallback(async (phoneNumber: string) => {
    if (activeCallGlobal) return;

    broadcastError(null);
    durationCounter = 0;
    broadcastDuration(0);
    broadcastStatus("connecting");

    try {
      const device = await ensureDevice();
      const call = await device.connect({
        params: { To: phoneNumber },
      });

      activeCallGlobal = call;

      call.on("ringing", () => broadcastStatus("ringing"));
      call.on("accept", () => {
        broadcastStatus("in-progress");
        durationCounter = 0;
        durationTimer = setInterval(() => {
          durationCounter++;
          broadcastDuration(durationCounter);
        }, 1000);
      });
      call.on("disconnect", () => {
        broadcastStatus("completed");
        activeCallGlobal = null;
        clearDurationTimer();
      });
      call.on("cancel", () => {
        broadcastStatus("idle");
        activeCallGlobal = null;
        clearDurationTimer();
      });
      call.on("error", (err: any) => {
        broadcastError(err.message || "Call failed");
        broadcastStatus("failed");
        activeCallGlobal = null;
        clearDurationTimer();
      });
    } catch (err: any) {
      broadcastError(err.message || "Failed to connect");
      broadcastStatus("failed");
    }
  }, [ensureDevice]);

  const hangUp = useCallback(() => {
    if (activeCallGlobal) {
      activeCallGlobal.disconnect();
      activeCallGlobal = null;
    }
    broadcastStatus("idle");
    clearDurationTimer();
  }, []);

  return {
    isConfigured,
    status,
    error,
    duration,
    makeCall,
    hangUp,
    isInCall: status === "connecting" || status === "ringing" || status === "in-progress",
  };
}

export function formatCallDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
