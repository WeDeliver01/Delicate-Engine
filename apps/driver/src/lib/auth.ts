import * as SecureStore from "expo-secure-store";

const KEY = "delicate.driver.token";

/**
 * The bearer token lives in the device keychain/keystore, never in plain storage.
 * Phase 2 ships dev-token sign-in (paste the token the engine mints); Supabase email sign-in
 * plugs in here without touching the rest of the app.
 */
export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string | null): Promise<void> {
  try {
    if (token) await SecureStore.setItemAsync(KEY, token);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* keychain unavailable (simulator reset) — the user signs in again */
  }
}
