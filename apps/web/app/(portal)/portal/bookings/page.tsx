"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Booking } from "@delicate/contracts";
import { useMe } from "@/components/use-me";
import { api } from "@/lib/api";
import { dateTime, rands } from "@/lib/money";
import { StatusBadge } from "@/components/booking/status-badge";

export default function BookingsPage() {
  const me = useMe();
  const account = me.activeAccount;
  const list = useQuery({
    queryKey: ["account", account?.id, "bookings"],
    queryFn: () => api<{ items: Booking[] }>("/v1/account/bookings?limit=50"),
    enabled: !!account,
  });
  if (!account) return null;
  const items = list.data?.items.filter((b) => !b.status.startsWith("rejected")) ?? [];
  return (
    <section className="rounded-xl border border-[#ECEAE6] bg-white">
      <div className="flex items-center justify-between border-b border-[#ECEAE6] px-5 py-4">
        <h1 className="text-xl font-bold">Bookings</h1>
        <Link
          href="/portal/book"
          className="rounded-full bg-[#0A0A0A] px-5 py-2 text-sm font-medium text-white hover:bg-[#E84A8A]"
        >
          New booking
        </Link>
      </div>
      <ul className="divide-y divide-[#F0EDE9] text-sm">
        {items.map((b) => (
          <li key={b.id}>
            <Link
              href={`/portal/bookings/${b.id}`}
              className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-[#FAFAF9]"
            >
              <div>
                <p className="font-mono font-semibold">{b.reference}</p>
                <p className="text-xs text-[#86817A]">
                  {b.shipments.length} drop{b.shipments.length === 1 ? "" : "s"} ·{" "}
                  {b.serviceLevelCode.replace("_", " ")}
                  {b.slotDate && ` · ${b.slotDate}`} · {dateTime(b.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono">{rands(b.totalCents)}</span>
                <StatusBadge status={b.status} />
              </div>
            </Link>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-5 py-8 text-center text-[#86817A]">No bookings yet.</li>
        )}
      </ul>
    </section>
  );
}
