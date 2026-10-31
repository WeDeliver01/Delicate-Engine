"use client";

import { useQuery } from "@tanstack/react-query";
import type { AccountAddresses as Addresses } from "@delicate/contracts";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/money";

/**
 * Where this account collects from.
 *
 * Two lists, kept apart on purpose. "Saved" is what the customer curated and will be offered
 * next time they book; "collected from" is read off the bookings themselves and is the only one
 * that exists before anybody saves anything — which is the answer ops actually needs when a
 * driver asks where to go.
 *
 * Delivery addresses are not here. They are one-off destinations, one per drop forever, so the
 * list would run to thousands and tell nobody anything; a drop belongs to its booking.
 */
export function AccountAddresses({ accountId }: { accountId: string }) {
  const addresses = useQuery({
    queryKey: ["admin", "accounts", accountId, "addresses"],
    queryFn: () => api<Addresses>(`/v1/admin/accounts/${accountId}/addresses`),
  });

  if (!addresses.data) return null;
  const { saved, collectionPoints } = addresses.data;

  return (
    <section className="panel">
      <div className="border-b border-line px-5 py-3">
        <h2 className="section-title">Addresses</h2>
        <p className="text-sm text-muted">
          Saved addresses are offered when this account books. Collected from is read off their
          actual bookings.
        </p>
      </div>

      <h3 className="label-mini border-b border-line bg-[#FAF8F5] px-5 py-2">Saved</h3>
      {saved.length === 0 ? (
        <p className="px-5 py-3 text-sm text-muted">
          Nothing saved yet — this account books by typing the address.
        </p>
      ) : (
        <ul className="divide-y divide-[#F0EDE9]">
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
        </ul>
      )}

      <h3 className="label-mini border-b border-line bg-[#FAF8F5] px-5 py-2">Collected from</h3>
      {collectionPoints.length === 0 ? (
        <p className="px-5 py-3 text-sm text-muted">
          No bookings yet, so nowhere has been collected from.
        </p>
      ) : (
        <ul className="divide-y divide-[#F0EDE9]">
          {collectionPoints.map((c) => (
            <li key={c.address.formatted} className="px-5 py-3">
              <p className="text-sm">{c.address.formatted}</p>
              <p className="text-xs text-muted">
                {c.contact?.name ? `${c.contact.name} · ` : ""}
                {c.contact?.phone ? `${c.contact.phone} · ` : ""}
                {c.timesUsed === 1 ? "once" : `${c.timesUsed}×`}, last{" "}
                <span className="font-mono">{c.lastBookingReference}</span> on{" "}
                {dateTime(c.lastUsedAt)}
              </p>
              {c.instructions && <p className="mt-1 text-xs text-muted">“{c.instructions}”</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
