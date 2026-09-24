import Constants from "expo-constants";
import type { ApiError } from "@delicate/contracts";
import { getToken } from "./auth";

/**
 * The engine's base URL. Set `EXPO_PUBLIC_API_URL` for real devices (a phone cannot reach the
 * laptop's "localhost"); the app.json value is the simulator default.
 */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  "http://localhost:8080";

export class ApiRequestError extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
    this.name = "ApiRequestError";
  }
  get code() {
    return this.error.code;
  }
  get status() {
    return this.error.statusCode;
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.json !== undefined) headers.set("content-type", "application/json");

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
  } catch (err) {
    throw new ApiRequestError({
      statusCode: 0,
      code: "network_error",
      message: `Cannot reach the engine at ${API_URL}. Check your signal and try again.`,
      details: String(err),
    });
  }

  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    throw new ApiRequestError(
      body && typeof body === "object" && "code" in body
        ? (body as ApiError)
        : { statusCode: res.status, code: "http_error", message: res.statusText },
    );
  }
  return body as T;
}
