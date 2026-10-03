"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  operatingToday,
  type Address,
  type CatalogResponse,
  type Quote,
} from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { rands } from "@/lib/money";
import { AddressInput } from "@/components/booking/address-input";
import { useCollectionPoint } from "@/components/booking/use-collection-point";
import { Breakdown } from "@/components/booking/breakdown";

/**
 * A price in one typed address.
 *
 * Everything else is either already known or has a sensible default: the collection point comes
 * from the account, the date starts at today, and the service level starts at standard. The
 * recipient is not asked for at all, because who receives the parcel does not change the
 * distance and a quote is a question about distance.
 *
 * The date is the exception, and it is asked for plainly rather than defaulted silently,
 * because it genuinely changes the number — a Saturday is not a Tuesday, and on-demand is not
 * standard. A price for the wrong day is worse than no price.
 */
export function QuickQuote({ onQuoted }: { onQuoted?: (quote: Quote) => void }) {
  const qc = useQueryClient();
  const collection = useCollectionPoint();

  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api<CatalogResponse>("/v1/public/catalog", { account: null }),
  });

  const [serviceLevel, setServiceLevel] = useState("standard");
  const [deliveryDate, setDeliveryDate] = useState(() => operatingToday());
  const [destination, setDestination] = useState<Address | null>(null);
  const [override, setOverride] = useState<Address | null>(null);
  const [showCollection, setShowCollection] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = override ?? collection.point?.address ?? null;

  // Any change makes the price stale, and a stale price on screen is worse than none.
  useEffect(() => setQuote(null), [serviceLevel, deliveryDate, destination, override]);

  async function getPrice() {
    if (!from || !destination) return;
    setBusy(true);
    setError(null);
    try {
      const q = await api<Quote>("/v1/account/quotes", {
        method: "POST",
        json: {
          serviceLevelCode: serviceLevel,
          collection: {
            address: from,
            contact: collection.point?.contact ?? null,
            instructions: collection.point?.instructions ?? null,
          },
          // No recipient and no parcels: the engine prices on the address, and the details
          // are collected when this becomes a booking.
          drops: [{ address: destination }],
          deliveryDate,
        },
      });
      setQuote(q);
      onQuoted?.(q);
      void qc.invalidateQueries({ queryKey: ["account"] });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const today = operatingToday();

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2 className="section-title">Get a price</h2>
          <p className="lede">Type where it is going. We know where it is coming from.</p>
        </div>
      </div>

      <div className="panel-body space-y-4">
        {/* ── Where from: already answered ─────────────────────────────── */}
        {collection.isLoading ? (
          <div className="h-10 animate-pulse rounded-xl bg-[#F3F1ED]" />
        ) : from ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#FAFAF9] px-3 py-2">
            <p className="min-w-0 text-sm">
              <span className="label-mini">Collecting from</span>
              <span className="mt-0.5 block truncate text-ink">{from.formatted}</span>
            </p>
            <button
              type="button"
              onClick={() => setShowCollection(!showCollection)}
              className="link-quiet text-xs"
            >
              {showCollection ? "Keep this" : "Collect from elsewhere"}
            </button>
          </div>
        ) : (
          <div className="alert-info">
            Save a collection point in{" "}
            <Link href="/portal/addresses" className="link-accent">
              your addresses
            </Link>{" "}
            and it will fill itself in here every time.
          </div>
        )}

        {(showCollection || !from) && (
          <AddressInput label="Collect from" value={override} onChange={setOverride} />
        )}

        {/* ── The one thing they type ──────────────────────────────────── */}
        <AddressInput label="Deliver to" value={destination} onChange={setDestination} />

        {/* ── What changes the price ───────────────────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">When</span>
            <input
              type="date"
              value={deliveryDate}
              min={today}
              max={addDays(today, 90)}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="input mt-1"
            />
            <span className="field-hint">Weekends and public holidays can price differently.</span>
          </label>

          <div>
            <span className="field-label">Service</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {catalog.data?.serviceLevels.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => setServiceLevel(s.code)}
                  title={s.description ?? undefined}
                  className={`chip transition-colors ${
                    serviceLevel === s.code
                      ? "bg-ink text-white"
                      : "chip-outline hover:border-ink hover:text-ink"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="alert-error">{error}</p>}

        {quote ? (
          <div className="rounded-xl border border-ink p-4">
            <div className="flex items-baseline justify-between">
              <span className="label-mini">Your price</span>
              <span className="figure text-2xl font-extrabold">
                {rands(quote.breakdown.totalCents)}
              </span>
            </div>
            <div className="mt-3">
              <Breakdown b={quote.breakdown} compact />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/portal/book?quote=${quote.id}`} className="btn btn-primary btn-sm">
                Book this
              </Link>
              <Link href={`/portal/quotes/${quote.id}`} className="btn btn-secondary btn-sm">
                Save or print
              </Link>
            </div>
            <p className="mt-2 text-xs text-muted">
              Held for 24 hours. We will ask who is receiving it when you book.
            </p>
          </div>
        ) : (
          <button
            type="button"
            disabled={!from || !destination || busy}
            onClick={getPrice}
            className="btn btn-primary w-full"
          >
            {busy ? "Pricing…" : "Get my price"}
          </button>
        )}
      </div>
    </section>
  );
}
