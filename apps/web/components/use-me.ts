"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { MeResponse } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { getActiveAccountId, setActiveAccountId, subscribeActiveAccount } from "@/lib/session";

const getServerSnapshot = () => null;

/**
 * The signed-in user, their accounts, and the active account. The active id lives in a shared
 * store, so switching in the header re-renders every page. Falls back to the first account
 * when nothing valid is stored, so a fresh login lands somewhere useful.
 */
export function useMe() {
  const query = useQuery<MeResponse, ApiRequestError>({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/v1/me", { account: null }),
  });
  const qc = useQueryClient();
  const activeId = useSyncExternalStore(
    subscribeActiveAccount,
    getActiveAccountId,
    getServerSnapshot,
  );

  useEffect(() => {
    if (!query.data) return;
    if (!query.data.accounts.some((a) => a.id === activeId)) {
      setActiveAccountId(query.data.accounts[0]?.id ?? null);
    }
  }, [query.data, activeId]);

  const switchAccount = useCallback(
    (id: string) => {
      setActiveAccountId(id);
      void qc.invalidateQueries({ queryKey: ["account"] });
    },
    [qc],
  );

  const activeAccount = query.data?.accounts.find((a) => a.id === activeId) ?? null;
  return { ...query, activeAccount, switchAccount };
}
