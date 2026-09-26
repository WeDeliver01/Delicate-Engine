"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Quote } from "@delicate/contracts";
import { useMe } from "@/components/use-me";
import { api, ApiRequestError } from "@/lib/api";
import { rands } from "@/lib/money";

/**
 * Saved quotes.
 *
 * A quote is a price with a shelf life, so the list leads with whether it is still good. An
 * expired one is not hidden — the customer still wants the numbers and the addresses — it just
 * cannot be booked until it has been priced again.
 */
export default function QuotesPage() {
  const me = useMe();
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const quotes = useQuery({
    queryKey: ["account", me.activeAccount?.id, "quotes"],
    queryFn: () => api<{ items: Quote[] }>("/v1/account/quotes"),
    enabled: !!me.activeAccount,
  });

  const rename = useMutation({
    mutationFn: (v: { id: string; label: string | null }) =>
      api<Quote>(`/v1/account/quotes/${v.id}`, { method: "PATCH", json: { label: v.label } }),
    onSuccess: () => {
      setRenaming(null);
      void qc.invalidateQueries({ queryKey: ["account", me.activeAccount?.id, "quotes"] });
    },
  });

  const reprice = useMutation({
    mutationFn: (id: string) => api<Quote>(`/v1/account/quotes/${id}/reprice`, { method: "POST" }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["account", me.activeAccount?.id, "quotes"] });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : String(e)),
  });

  const items = quotes.data?.items ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{me.activeAccount?.name}</p>
          <h1 className="page-title mt-1">Quotes</h1>
          <p className="lede mt-1">
            Prices we have worked out for you. A quote holds for 24 hours, then it needs pricing
            again.
          </p>
        </div>
        <Link href="/portal/book" className="btn btn-primary">
          New quote
        </Link>
      </header>

      {error && <p className="alert-error">{error}</p>}

      {quotes.isLoading ? (
        <div className="panel">
          <p className="table-empty">Loading…</p>
        </div>
      ) : !items.length ? (
        <div className="panel">
          <p className="table-empty">
            No quotes yet. Start a booking and we will price it — you can stop there and keep the
            quote.
          </p>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Name</th>
                <th>Service</th>
                <th>Drops</th>
                <th className="text-right">Total</th>
                <th>Valid</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((q) => (
                <tr key={q.id} className="transition-colors hover:bg-[#FAFAF9]">
                  <td className="font-mono">{q.reference ?? q.id.slice(0, 8)}</td>
                  <td>
                    {renaming === q.id ? (
                      <div className="flex gap-1">
                        <input
                          autoFocus
                          value={label}
                          onChange={(e) => setLabel(e.target.value)}
                          onKeyDown={(e) =>
                            e.key === "Enter" &&
                            rename.mutate({ id: q.id, label: label.trim() || null })
                          }
                          placeholder="Saturday market run"
                          className="input py-1"
                        />
                        <button
                          onClick={() => rename.mutate({ id: q.id, label: label.trim() || null })}
                          className="btn btn-primary btn-sm"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setRenaming(q.id);
                          setLabel(q.label ?? "");
                        }}
                        className={q.label ? "hover:underline" : "link-quiet hover:underline"}
                      >
                        {q.label ?? "Name this quote"}
                      </button>
                    )}
                  </td>
                  <td>{q.serviceLevelCode}</td>
                  <td className="figure">{q.request.drops.length}</td>
                  <td className="figure text-right font-medium">{rands(q.breakdown.totalCents)}</td>
                  <td>
                    <QuoteStatus quote={q} />
                  </td>
                  <td className="text-right">
                    <div className="inline-flex gap-1.5">
                      <Link
                        href={`/portal/quotes/${q.id}`}
                        className="link-quiet text-xs hover:underline"
                      >
                        View
                      </Link>
                      {q.status === "priced" && (
                        <Link href={`/portal/book?quote=${q.id}`} className="link-accent text-xs">
                          Book
                        </Link>
                      )}
                      {q.status === "expired" && (
                        <button
                          onClick={() => reprice.mutate(q.id)}
                          disabled={reprice.isPending}
                          className="link-accent text-xs"
                        >
                          Price again
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function QuoteStatus({ quote }: { quote: Quote }) {
  if (quote.status === "booked") return <span className="chip chip-neutral">Booked</span>;
  if (quote.status === "expired") return <span className="chip chip-warn">Expired</span>;

  const hoursLeft = Math.round((Date.parse(quote.expiresAt) - Date.now()) / 3_600_000);
  return (
    <span className="chip chip-good">
      {hoursLeft <= 1 ? "Under an hour" : `${hoursLeft} hours left`}
    </span>
  );
}
