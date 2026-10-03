"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CompanyTaxProfile, Quote } from "@delicate/contracts";
import { api } from "@/lib/api";
import { rands } from "@/lib/money";
import { Breakdown } from "@/components/booking/breakdown";

/**
 * One quote as a document the customer can print, save as a PDF or email on.
 *
 * Deliberately not just the breakdown panel from the booking form: a quote that leaves our
 * site has to stand on its own, so it carries who we are, what exactly was priced, and when
 * the price stops being valid.
 */
export default function QuoteDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const quote = useQuery({
    queryKey: ["quote", id],
    queryFn: () => api<Quote>(`/v1/account/quotes/${id}`),
  });

  // The carrier identity lives in settings and the marketing site already reads it publicly.
  const company = useQuery({
    queryKey: ["company"],
    queryFn: () => api<CompanyTaxProfile>("/v1/public/company", { account: null }),
  });

  if (quote.isLoading) return <p className="lede">Loading…</p>;
  if (quote.error) return <p className="alert-error">{(quote.error as Error).message}</p>;
  const q = quote.data;
  if (!q) return null;

  const expired = q.status === "expired" || Date.parse(q.expiresAt) < Date.now();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/portal/quotes" className="link-quiet text-xs">
          ← All quotes
        </Link>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="btn btn-secondary btn-sm">
            Print or save as PDF
          </button>
          {!expired && (
            <Link href={`/portal/book?quote=${q.id}`} className="btn btn-primary btn-sm">
              Turn into a booking
            </Link>
          )}
        </div>
      </div>

      <article className="mx-auto max-w-[210mm] rounded-xl border border-line bg-white p-8 text-[13px] print:max-w-none print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-ink pb-4">
          <div>
            <div className="font-display text-xl font-extrabold tracking-tight">
              {company.data?.legalName ?? "Delicate Courier"}
            </div>
            {company.data && (
              <>
                <div className="mt-1 text-[#6B6661]">{company.data.address.formatted}</div>
                <div className="text-[#6B6661]">
                  {company.data.email} · {company.data.phone}
                </div>
                {company.data.vatNumber && (
                  <div className="text-muted">VAT no. {company.data.vatNumber}</div>
                )}
              </>
            )}
          </div>
          <div className="text-right">
            <div className="font-display text-lg font-bold tracking-wide">QUOTATION</div>
            <div className="figure mt-1 text-xl font-extrabold">{q.reference ?? "—"}</div>
            {q.label && <div className="mt-0.5 text-muted">{q.label}</div>}
            <div className="mt-1 text-muted">
              Issued {new Date(q.createdAt).toLocaleDateString("en-ZA")}
            </div>
            <div className={expired ? "text-[#C13B73]" : "text-muted"}>
              {expired ? "Expired " : "Valid until "}
              {new Date(q.expiresAt).toLocaleString("en-ZA")}
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-line p-3 print:rounded-none">
            <p className="label-mini">Collect from</p>
            <p className="mt-1">{q.request.collection.address.formatted}</p>
            {q.request.collection.contact && (
              <p className="mt-0.5 text-[#6B6661]">
                {q.request.collection.contact.name} · {q.request.collection.contact.phone}
              </p>
            )}
          </div>
          <div className="rounded-xl border border-line p-3 print:rounded-none">
            <p className="label-mini">Service</p>
            <p className="mt-1 font-medium">{q.serviceLevelCode}</p>
            <p className="text-[#6B6661]">
              {q.request.drops.length} {q.request.drops.length === 1 ? "delivery" : "deliveries"}
            </p>
          </div>
        </section>

        <section className="mt-5">
          <h2 className="label-mini">Deliveries</h2>
          <table className="mt-2 w-full border-collapse text-left">
            <thead>
              <tr className="border-y border-line text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1.5 pr-2 font-medium">#</th>
                <th className="py-1.5 pr-2 font-medium">Deliver to</th>
                <th className="py-1.5 pr-2 font-medium">Recipient</th>
                <th className="py-1.5 text-right font-medium">Parcels</th>
              </tr>
            </thead>
            <tbody>
              {q.request.drops.map((d, i) => (
                <tr key={i} className="border-b border-[#F0EDE9]">
                  <td className="py-1.5 pr-2 text-muted">{i + 1}</td>
                  <td className="py-1.5 pr-2">{d.address.formatted}</td>
                  <td className="py-1.5 pr-2">
                    {d.recipient?.name ?? <span className="text-muted">To be confirmed</span>}
                  </td>
                  <td className="figure py-1.5 text-right">
                    {d.parcels.reduce((n, p) => n + p.quantity, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-5 sm:w-1/2 sm:ml-auto">
          <Breakdown b={q.breakdown} />
          <div className="mt-2 flex items-center justify-between border-t-2 border-ink pt-2">
            <span className="font-semibold">Total</span>
            <span className="figure text-lg font-extrabold">{rands(q.breakdown.totalCents)}</span>
          </div>
        </section>

        <footer className="mt-6 border-t border-line pt-3 text-[10px] leading-relaxed text-muted">
          This quotation is based on the addresses and parcels listed above and the rate card in
          force at the time of issue. It is valid until the date shown; after that the delivery must
          be priced again. Prices are in South African Rand.
        </footer>
      </article>
    </div>
  );
}
