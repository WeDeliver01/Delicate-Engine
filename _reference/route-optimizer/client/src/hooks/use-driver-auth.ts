import { useState, useEffect, useCallback } from "react";
import { getToken, getDriverInfo, clearAuth, onAuthChange, type DriverInfo } from "@/lib/driver-api";
import { registerPushNotifications, unregisterPushNotifications, isNativeSync } from "@/lib/driver-push";
import { useLocation } from "wouter";

export function useDriverAuth() {
  const [token, setToken] = useState<string | null>(getToken);
  const [driver, setDriver] = useState<DriverInfo | null>(getDriverInfo);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (token && isNativeSync()) {
      registerPushNotifications().catch(() => {});
    }
  }, [token]);

  useEffect(() => {
    const unsub = onAuthChange(() => {
      const t = getToken();
      const d = getDriverInfo();
      const wasAuthed = !!token;
      setToken(t);
      setDriver(d);
      if (!t) {
        if (wasAuthed && isNativeSync()) {
          unregisterPushNotifications().catch(() => {});
        }
        setLocation("/driver/login");
      } else if (isNativeSync()) {
        registerPushNotifications().catch(() => {});
      }
    });
    return unsub;
  }, [setLocation, token]);

  const logout = useCallback(async () => {
    if (isNativeSync()) {
      try { await unregisterPushNotifications(); } catch {}
    }
    clearAuth();
  }, []);

  const refresh = useCallback(() => {
    setToken(getToken());
    setDriver(getDriverInfo());
  }, []);

  return { token, driver, isAuthenticated: !!token, logout, refresh };
}
