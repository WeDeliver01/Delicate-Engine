"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv, supabaseEnabled } from "./env";

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Browser Supabase client (PKCE). Null when Supabase is not configured (dev-token mode). */
export function getSupabase() {
  if (!supabaseEnabled) return null;
  if (!client) {
    client = createBrowserClient(publicEnv.supabaseUrl!, publicEnv.supabaseAnonKey!);
  }
  return client;
}

/**
 * Catch the configuration mistake that otherwise surfaces as "Unexpected token '<'".
 *
 * If NEXT_PUBLIC_SUPABASE_URL is set to this site rather than to the Supabase project, every
 * auth call is sent to our own server, which answers with an HTML page and the Supabase client
 * fails trying to parse it as JSON. The message blames the JSON; the cause is a URL set two
 * screens away, at build time, which is a long way to travel from the symptom.
 */
export function supabaseMisconfigured(): string | null {
  if (!supabaseEnabled || typeof window === "undefined") return null;
  try {
    const configured = new URL(publicEnv.supabaseUrl!);
    if (configured.origin === window.location.origin) {
      return "Sign-in is pointed at this site instead of the Supabase project. Set NEXT_PUBLIC_SUPABASE_URL to the project URL (https://<ref>.supabase.co) and rebuild.";
    }
  } catch {
    return "Sign-in is misconfigured: NEXT_PUBLIC_SUPABASE_URL is not a valid URL.";
  }
  return null;
}
