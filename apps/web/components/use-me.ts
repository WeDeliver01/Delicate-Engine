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
  const qc = useQueryClient();
  const activeId = useSyncExternalStore(
    subscribeActiveAccount,
    getActiveAccountId,
    getServerSnapshot,
  );

  const query = useQuery<MeResponse, ApiRequestError>({
    /*
      Keyed on the active account, because the answer depends on it: the same user asking
      while stepped into a customer gets `actingAs` back, and the portal needs that the moment
      it happens rather than on the next reload.
    */
    queryKey: ["me", activeId],
    queryFn: () =>
      api<MeResponse>(`/v1/me${activeId ? `?actingAs=${encodeURIComponent(activeId)}` : ""}`, {
        // Named in the query string instead of the header on purpose -- see the controller.
        // A stale id must not be able to 403 the request that tells the page who you are.
        account: null,
      }),
  });

  useEffect(() => {
    if (!query.data) return;
    // Staff stepped into a customer: the account is deliberately not one of theirs, and
    // resetting here would throw them straight back out of it.
    if (query.data.actingAs) return;
    if (query.data.accounts.some((a) => a.id === activeId)) return;
    setActiveAccountId(query.data.accounts[0]?.id ?? null);
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
