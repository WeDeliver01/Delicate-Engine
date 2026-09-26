"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CatalogResponse, ShipmentStatus } from "@delicate/contracts";
import { api } from "@/lib/api";
import {
  EMPTY_FILTERS,
  ShipmentFilterBar,
  filtersToQuery,
  useDebounced,
  type ShipmentFilters,
} from "@/components/shipments/filter-bar";
import { ShipmentTable, type ShipmentRow } from "@/components/shipments/shipment-table";

/**
 * The operations board.
 *
 * Same filter bar and table as the customer sees, because they are looking at the same objects
 * and two implementations would drift. What differs is the default: ops care about today and
 * about what is going wrong, so the page opens on today rather than on the last month.
 */
export default function AdminShipmentsPage() {
  const [filters, setFilters] = useState<ShipmentFilters>({
    ...EMPTY_FILTERS,
    period: { key: "today", from: null, to: null },
    sort: "slot_asc",
  });

  const debouncedSearch = useDebounced(filters.search);
  const query = useMemo(
    () => filtersToQuery({ ...filters, search: debouncedSearch }, { limit: "100" }),
    [filters, debouncedSearch],
  );

  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api<CatalogResponse>("/v1/public/catalog", { account: null }),
  });

  const list = useQuery({
    queryKey: ["admin", "shipment-search", query],
    queryFn: () =>
      api<{ items: ShipmentRow[]; nextCursor: string | null }>(
        `/v1/admin/shipment-search?${query}`,
      ),
    refetchInterval: 60_000,
  });

  const counts = useQuery({
    queryKey: ["admin", "shipment-counts", query],
    queryFn: () =>
      api<Partial<Record<ShipmentStatus, number>>>(`/v1/admin/shipment-counts?${query}`),
    refetchInterval: 60_000,
  });

  const pending = useQuery({
    queryKey: ["admin", "changes", "pending-count"],
    queryFn: () => api<{ count: number }>("/v1/admin/changes/pending-count"),
    refetchInterval: 60_000,
  });

  const rows = list.data?.items ?? [];
  const total = Object.values(counts.data ?? {}).reduce((a, b) => a + b, 0);
  const late = rows.filter((r) => r.isLate).length;
  const unassigned = rows.filter((r) => !r.driver && r.status === "booked").length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Operations</p>
          <h1 className="page-title mt-1">Shipments</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {!!pending.data?.count && (
            <Link href="/admin/changes" className="chip chip-warn">
              {pending.data.count} change{pending.data.count === 1 ? "" : "s"} to approve
            </Link>
          )}
          {!!late && (
            <button
              type="button"
              onClick={() => setFilters({ ...filters, flags: ["late"] })}
              className="chip chip-bad"
            >
              {late} late
            </button>
          )}
          {!!unassigned && (
            <button
              type="button"
              onClick={() => setFilters({ ...filters, flags: ["unassigned"] })}
              className="chip chip-info"
            >
              {unassigned} unassigned
            </button>
          )}
        </div>
      </header>

      <ShipmentFilterBar
        value={filters}
        onChange={setFilters}
        scope="admin"
        serviceLevels={catalog.data?.serviceLevels.map((s) => ({ code: s.code, name: s.name }))}
      />

      <div className="flex items-center justify-between">
        <p className="lede">
          {counts.isLoading ? "Counting…" : `${total} shipments · showing ${rows.length}`}
        </p>
        {list.isFetching && <span className="text-xs text-muted">Refreshing…</span>}
      </div>

      <ShipmentTable
        rows={rows}
        loading={list.isLoading}
        hrefBase="/admin/shipments"
        showAccount
        emptyMessage="Nothing matches. Widen the period or clear a filter."
      />
    </div>
  );
}
