"use client";

import { useEffect, useState } from "react";
import { publicEnv, supabaseEnabled } from "@/lib/env";

interface AuthSettings {
  external?: Record<string, boolean>;
  disable_signup?: boolean;
}

export interface AuthProviders {
  /** Still asking. Render neither state yet rather than flashing one and then the other. */
  loading: boolean;
  google: boolean;
  /** Email and password, as opposed to a social provider. */
  password: boolean;
  /** The project is not taking new users at all, however they arrive. */
  signupDisabled: boolean;
}

/**
 * What the Supabase project will actually accept.
 *
 * Offering "Continue with Google" on a project where Google is switched off produces a button
 * that fails every time it is pressed, and nothing on the page explains why — the provider is
 * a dashboard setting, invisible from here. So we ask. `/auth/v1/settings` is public (the anon
 * key is all it wants) and is the same thing the dashboard reads.
 *
 * On any failure we assume the ordinary configuration — password yes, Google no — because the
 * cost of wrongly hiding a button is one extra sign-in method missing for a moment, and the
 * cost of wrongly showing one is a customer who cannot tell whether it is them or us.
 */
export function useAuthProviders(): AuthProviders {
  const [state, setState] = useState<AuthProviders>({
    loading: supabaseEnabled,
    google: false,
    password: true,
    signupDisabled: false,
  });

  useEffect(() => {
    if (!supabaseEnabled) return;
    const key = publicEnv.supabaseAnonKey!;
    const controller = new AbortController();

    fetch(`${publicEnv.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: controller.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<AuthSettings>) : null))
      .then((s) =>
        setState({
          loading: false,
          google: s?.external?.["google"] ?? false,
          password: s?.external?.["email"] ?? true,
          signupDisabled: s?.disable_signup ?? false,
        }),
      )
      .catch(() => setState((p) => ({ ...p, loading: false })));

    return () => controller.abort();
  }, []);

  return state;
}
