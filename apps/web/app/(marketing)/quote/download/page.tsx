"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CompanyTaxProfile } from "@delicate/contracts";
import { api } from "@/lib/api";
import { rands } from "@/lib/money";
import { Breakdown } from "@/components/booking/breakdown";
import { PENDING_ESTIMATE_KEY, type PendingEstimate } from "../pending-estimate";

/**
 * A one-off estimate as a document, for whoever asked before they ever signed in.
 *
 * Not a `Quote`: there is no account to save it against, so there is no id, no reference, no
 * expiry — only the number this session just got, read back out of `pending-estimate.tsx`.
 * `print:` classes strip the page chrome so Ctrl-P / "Save as PDF" is the entire export path,
 * the same way the portal's quote and invoice documents do it.
 */
export default function EstimateDownloadPage() {
  const [pending, setPending] = useState<PendingEstimate | null | undefined>(undefined);

  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_ESTIMATE_KEY);
    setPending(raw ? (JSON.parse(raw) as PendingEstimate) : null);
  }, []);

  // The one public endpoint that is allowed to carry the bank account: this document exists so
  // someone can pay against it before they have ever signed in.
  const company = useQuery({
    queryKey: ["public", "quote-letterhead"],
    queryFn: () => api<CompanyTaxProfile>("/v1/public/quote-letterhead", { account: null }),
  });

  if (pending === undefined) return null;

  if (!pending) {
    return (
      <div className="mx-auto max-w-lg px-5 py-16 text-center">
        <p className="lede">We don't have an estimate to show.</p>
        <Link href="/quote" className="link-quiet mt-3 inline-block text-sm">
          ← Get a new estimate
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[210mm] space-y-4 px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/quote" className="link-quiet text-xs">
          ← Back to the estimate
        </Link>
        <button type="button" onClick={() => window.print()} className="btn btn-primary btn-sm">
          Download as PDF
        </button>
      </div>

      <article className="rounded-xl border border-line bg-white p-8 text-[13px] print:rounded-none print:border-0 print:p-0">
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
            <div className="font-display text-lg font-bold tracking-wide">ESTIMATE</div>
            <div className="mt-1 text-muted">
              {new Date(pending.createdAt).toLocaleString("en-ZA")}
            </div>
            <div className="text-muted">Today's standard rates</div>
          </div>
        </header>

        <section className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-line p-3 print:rounded-none">
            <p className="label-mini">Collect from</p>
            <p className="mt-1">{pending.collection.formatted}</p>
          </div>
          <div className="rounded-xl border border-line p-3 print:rounded-none">
            <p className="label-mini">Service</p>
            <p className="mt-1 font-medium">{pending.serviceLevelName}</p>
            <p className="text-[#6B6661]">{pending.packageTypeName}</p>
          </div>
          {company.data?.bank.accountNumber && (
            <div className="rounded-xl border border-line p-3 sm:col-span-2 print:rounded-none">
              <p className="label-mini">Banking details</p>
              <p className="mt-1 text-[#6B6661]">
                {company.data.bank.bankName} · {company.data.bank.accountName}
              </p>
              <p className="figure text-[#6B6661]">
                {company.data.bank.accountNumber} · branch {company.data.bank.branchCode}
              </p>
              <p className="mt-1 text-[11px] text-muted">
                This is an estimate, not an invoice — please wait for a booking reference before
                paying.
              </p>
            </div>
          )}
        </section>

        <section className="mt-5">
          <h2 className="label-mini">Deliveries</h2>
          <table className="mt-2 w-full border-collapse text-left">
            <thead>
              <tr className="border-y border-line text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1.5 pr-2 font-medium">#</th>
                <th className="py-1.5 font-medium">Deliver to</th>
              </tr>
            </thead>
            <tbody>
              {pending.drops.map((d, i) => (
                <tr key={i} className="border-b border-[#F0EDE9]">
                  <td className="py-1.5 pr-2 text-muted">{i + 1}</td>
                  <td className="py-1.5">{d.formatted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-5 sm:w-1/2 sm:ml-auto">
          <Breakdown b={pending.breakdown} />
          <div className="mt-2 flex items-center justify-between border-t-2 border-ink pt-2">
            <span className="font-semibold">Total</span>
            <span className="figure text-lg font-extrabold">
              {rands(pending.breakdown.totalCents)}
            </span>
          </div>
        </section>

        <footer className="mt-6 border-t border-line pt-3 text-[10px] leading-relaxed text-muted">
          This is an unsaved estimate on our standard rates, not a bookable quote: account holders
          may have negotiated pricing, and distances are approximate until the booking is made.
          Prices are in South African Rand.
        </footer>
      </article>
    </div>
  );
}
