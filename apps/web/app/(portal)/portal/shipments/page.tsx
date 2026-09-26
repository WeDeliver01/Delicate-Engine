"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ShipmentStatus } from "@delicate/contracts";
import { useMe } from "@/components/use-me";
import { api } from "@/lib/api";
import {
  EMPTY_FILTERS,
  ShipmentFilterBar,
  filtersToQuery,
  useDebounced,
  type ShipmentFilters,
} from "@/components/shipments/filter-bar";
import { ShipmentTable, type ShipmentRow } from "@/components/shipments/shipment-table";
import type { PeriodKey } from "@delicate/contracts";

export default function PortalShipmentsPage() {
  return (
    <Suspense fallback={<p className="lede">Loading…</p>}>
      <Shipments />
    </Suspense>
  );
}

function Shipments() {
  const me = useMe();
  const params = useSearchParams();

  // The dashboard tiles link here with a filter already applied, so the URL seeds the state.
  // It is only read once: after that the bar owns it, or every change would fight the URL.
  const [filters, setFilters] = useState<ShipmentFilters>(() => {
    const status = params.getAll("status") as ShipmentStatus[];
    const period = (params.get("period") as PeriodKey | null) ?? null;
    return {
      ...EMPTY_FILTERS,
      status,
      period: period
        ? { key: period, from: params.get("from"), to: params.get("to") }
        : EMPTY_FILTERS.period,
      sort: "slot_desc",
    };
  });

  const debouncedSearch = useDebounced(filters.search);
  const query = useMemo(
    () => filtersToQuery({ ...filters, search: debouncedSearch }, { limit: "50" }),
    [filters, debouncedSearch],
  );

  const list = useQuery({
    queryKey: ["account", me.activeAccount?.id, "shipment-search", query],
    queryFn: () =>
      api<{ items: ShipmentRow[]; nextCursor: string | null }>(
        `/v1/account/shipment-search?${query}`,
      ),
    enabled: !!me.activeAccount,
  });

  const counts = useQuery({
    queryKey: ["account", me.activeAccount?.id, "shipment-counts", query],
    queryFn: () =>
      api<Partial<Record<ShipmentStatus, number>>>(`/v1/account/shipment-counts?${query}`),
    enabled: !!me.activeAccount,
  });

  const total = Object.values(counts.data ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{me.activeAccount?.name}</p>
          <h1 className="page-title mt-1">Shipments</h1>
        </div>
        <p className="lede">{counts.isLoading ? "Counting…" : `${total} matching this period`}</p>
      </header>

      <ShipmentFilterBar value={filters} onChange={setFilters} scope="portal" />

      <ShipmentTable
        rows={list.data?.items ?? []}
        loading={list.isLoading}
        hrefBase="/portal/shipments"
        emptyMessage="No shipments match these filters. Try widening the period."
      />
    </div>
  );
}
