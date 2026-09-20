/**
 * Browser-visible configuration. Only NEXT_PUBLIC_* values belong here.
 *
 * The API is reached through the same-origin `/api` proxy (see next.config.ts), so no URL is
 * needed; NEXT_PUBLIC_API_URL exists only to point a build at a separately hosted engine.
 * Supabase is optional in local dev: when unset, the login page offers dev tokens instead.
 */
export const publicEnv = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL || "/api").replace(/\/$/, ""),
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null,
};

export const supabaseEnabled = Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
