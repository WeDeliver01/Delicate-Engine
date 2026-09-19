/**
 * Browser-visible configuration. Only NEXT_PUBLIC_* values belong here.
 * Supabase is optional in local dev: when unset, the login page offers dev tokens instead.
 */
export const publicEnv = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null,
};

export const supabaseEnabled = Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
