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
