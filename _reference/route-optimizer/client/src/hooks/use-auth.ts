import { useState, useEffect, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import { destroyTwilioDevice } from "@/hooks/use-twilio-call";

interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  role: string;
  avatarColor: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { username, password });
    const data = await res.json();
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (username: string, password: string, displayName: string, email?: string) => {
    const res = await apiRequest("POST", "/api/auth/register", { username, password, displayName, email });
    const data = await res.json();
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    destroyTwilioDevice();
    await apiRequest("POST", "/api/auth/logout");
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (data: {
    displayName?: string;
    email?: string;
    avatarColor?: string;
    currentPassword?: string;
    newPassword?: string;
  }) => {
    const res = await apiRequest("PATCH", "/api/auth/profile", data);
    const result = await res.json();
    setUser(result.user);
    return result.user;
  }, []);

  return { user, loading, login, register, logout, updateProfile, checkAuth };
}
