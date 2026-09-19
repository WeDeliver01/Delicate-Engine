"use client";

import { getSupabase } from "./supabase";

const DEV_TOKEN_KEY = "delicate.devToken";
const ACTIVE_ACCOUNT_KEY = "delicate.activeAccountId";

/**
 * Session access for the browser. Two sources of bearer tokens:
 *  - Supabase session (production): refreshed automatically by supabase-js.
 *  - Dev token pasted on the login page (local dev without a Supabase project).
 * The active account id is a per-viewer convenience kept in localStorage.
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }
  return safeGet(DEV_TOKEN_KEY);
}

export function setDevToken(token: string | null): void {
  safeSet(DEV_TOKEN_KEY, token);
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (supabase) await supabase.auth.signOut();
  safeSet(DEV_TOKEN_KEY, null);
  setActiveAccountId(null);
}

/**
 * Active account id as a tiny external store so every component (header switcher, pages)
 * observes the same value; localStorage persists it per viewer.
 */
const listeners = new Set<() => void>();

export function getActiveAccountId(): string | null {
  return safeGet(ACTIVE_ACCOUNT_KEY);
}

export function setActiveAccountId(id: string | null): void {
  safeSet(ACTIVE_ACCOUNT_KEY, id);
  listeners.forEach((l) => l());
}

export function subscribeActiveAccount(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}
