"use client";

import type { ApiError } from "@delicate/contracts";
import { publicEnv } from "./env";
import { getAccessToken, getActiveAccountId } from "./session";

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

/**
 * Typed fetch against the engine. Attaches the bearer token and the active account header on
 * every call, and turns the standard ApiError body into a thrown ApiRequestError.
 */
export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown; account?: string | null } = {},
): Promise<T> {
  const token = await getAccessToken();
  const accountId = init.account === undefined ? getActiveAccountId() : init.account;

  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (accountId) headers.set("x-account-id", accountId);
  if (init.json !== undefined) headers.set("content-type", "application/json");

  let res: Response;
  try {
    res = await fetch(`${publicEnv.apiUrl}${path}`, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
  } catch (err) {
    throw new ApiRequestError({
      statusCode: 0,
      code: "network_error",
      message: `could not reach the engine at ${publicEnv.apiUrl}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    const err: ApiError =
      body && typeof body === "object" && "code" in body
        ? (body as ApiError)
        : { statusCode: res.status, code: "http_error", message: res.statusText };
    throw new ApiRequestError(err);
  }
  return body as T;
}
