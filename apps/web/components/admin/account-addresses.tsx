"use client";

import { useQuery } from "@tanstack/react-query";
import type { AccountAddresses as Addresses, BookedAddress } from "@delicate/contracts";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/money";

/**
 * Where this account collects from and delivers to.
 *
 * Two lists, kept apart on purpose. "Saved" is what the customer curated and will be offered
 * next time they book; "used" is read off the bookings themselves and is the only one that
 * exists before anybody saves anything — which is the answer ops actually needs when a driver
 * is asking where to go.
 */
export function AccountAddresses({ accountId }: { accountId: string }) {
  const addresses = useQuery({
    queryKey: ["admin", "accounts", accountId, "addresses"],
    queryFn: () => api<Addresses>(`/v1/admin/accounts/${accountId}/addresses`),
  });

  if (!addresses.data) return null;
  const { saved, booked } = addresses.data;
  const collections = booked.filter((b) => b.role === "collection");
  const deliveries = booked.filter((b) => b.role === "delivery");

  return (
    <section className="panel">
      <div className="border-b border-line px-5 py-3">
        <h2 className="section-title">Addresses</h2>
        <p className="text-sm text-muted">
          Saved addresses are offered when this account books. Collected from and delivered to are
          read off their actual bookings.
        </p>
      </div>

      <Group title="Saved" empty="Nothing saved yet — this account books by typing the address.">
        {saved.map((a) => (
          <li key={a.id} className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{a.label}</span>
              {a.isCollectionPoint && <span className="chip chip-neutral">collection point</span>}
              {a.isDefault && <span className="chip chip-neutral">default</span>}
            </div>
            <p className="text-sm">{a.address.formatted}</p>
            <p className="text-xs text-muted">
              {a.contact.name}
              {a.contact.phone ? ` · ${a.contact.phone}` : ""}
              {a.instructions ? ` · ${a.instructions}` : ""}
            </p>
          </li>
        ))}
      </Group>

      <Group
        title="Collected from"
        empty="No bookings yet, so nowhere has been collected from."
        rows={collections}
      />
      <Group title="Delivered to" empty="No drops yet." rows={deliveries} />
    </section>
  );
}

function Group({
  title,
  empty,
  rows,
  children,
}: {
  title: string;
  empty: string;
  rows?: BookedAddress[];
  children?: React.ReactNode;
}) {
  const items =
    children ??
    rows?.map((b) => (
      <li key={`${b.bookingId}:${b.waybill ?? "collection"}`} className="px-5 py-3">
        <p className="text-sm">{b.address.formatted}</p>
        <p className="text-xs text-muted">
          {b.contact?.name ? `${b.contact.name} · ` : ""}
          {b.contact?.phone ? `${b.contact.phone} · ` : ""}
          <span className="font-mono">{b.waybill ?? b.bookingReference}</span> ·{" "}
          {dateTime(b.usedAt)}
        </p>
      </li>
    ));
  const isEmpty = !items || (Array.isArray(items) && items.length === 0);

  return (
    <>
      <h3 className="label-mini border-b border-line bg-[#FAF8F5] px-5 py-2">{title}</h3>
      {isEmpty ? (
        <p className="px-5 py-3 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-[#F0EDE9]">{items}</ul>
      )}
    </>
  );
}
