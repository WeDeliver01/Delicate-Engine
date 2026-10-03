"use client";

import { useQuery } from "@tanstack/react-query";
import type { SavedAddress } from "@delicate/contracts";
import { useMe } from "@/components/use-me";
import { api } from "@/lib/api";

/**
 * The account's own collection point, for filling in their side of a form before they look at
 * it.
 *
 * A signed-in customer always collects from the same place — their kitchen, their shop, their
 * studio. Asking them to type it again on every quote is a question we already know the answer
 * to, and it is the single biggest thing standing between "I want a price" and seeing one.
 *
 * The one marked default wins; failing that, the collection point they use most. A business
 * with two kitchens still gets the busier one pre-filled and can change it in a click.
 */
export function useCollectionPoint() {
  const me = useMe();
  const account = me.activeAccount;

  const query = useQuery({
    queryKey: ["account", account?.id, "address-book"],
    queryFn: () => api<{ items: SavedAddress[] }>("/v1/account/address-book?limit=100"),
    enabled: !!account,
    // Addresses change rarely; refetching one per page view would be a request for nothing.
    staleTime: 5 * 60_000,
  });

  const points = (query.data?.items ?? []).filter((a) => a.isCollectionPoint);
  const preferred =
    points.find((a) => a.isDefault) ??
    [...points].sort((a, b) => b.useCount - a.useCount)[0] ??
    null;

  return {
    /** Null while loading, or when the account has never saved a collection point. */
    point: preferred,
    /** Every collection point, so a form can offer the others without a second request. */
    all: points,
    isLoading: query.isLoading,
  };
}
