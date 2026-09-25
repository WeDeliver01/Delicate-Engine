"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Invoice, Statement } from "@delicate/contracts";
import { api } from "@/lib/api";
import { dateOnly, dateTime, rands } from "@/lib/money";
import { InvoiceDocument } from "@/components/billing/invoice-document";

/** A customer's own documents: their invoices, and a statement they can reconcile against. */
export default function PortalInvoices() {
  const [open, setOpen] = useState<string | null>(null);
  const [range, setRange] = useState(defaultRange());

  const invoices = useQuery({
    queryKey: ["portal", "invoices"],
    queryFn: () => api<Invoice[]>("/v1/account/billing/invoices?limit=100"),
  });
  const statement = useQuery({
    queryKey: ["portal", "statement", range.from, range.to],
    queryFn: () =>
      api<Statement>(`/v1/account/billing/statement?from=${range.from}&to=${range.to}`),
  });

  const st = statement.data;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <header>
        <h1 className="page-title">Invoices &amp; statements</h1>
        <p className="mt-1 text-sm text-[#6B6661]">
          Every delivery you are charged for appears here, with the VAT shown separately for your
          bookkeeping.
        </p>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2 className="section-title">Statement</h2>
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange({ ...range, from: e.target.value })}
            className="input px-2 py-1 text-sm"
          />
          <span className="text-sm text-muted">to</span>
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange({ ...range, to: e.target.value })}
            className="input px-2 py-1 text-sm"
          />
        </div>

        {st && (
          <>
            <div className="grid gap-3 p-5 sm:grid-cols-4">
              <Stat label="Opening balance" value={rands(st.openingBalanceCents)} />
              <Stat label="Topped up" value={rands(st.toppedUpCents)} />
              <Stat label="Charged" value={rands(st.chargedCents)} />
              <Stat label="Closing balance" value={rands(st.closingBalanceCents)} />
            </div>
            <table className="w-full text-left text-sm">
              <thead className="label-mini">
                <tr>
                  <th className="px-5 py-2">When</th>
                  <th className="px-5 py-2">Description</th>
                  <th className="px-5 py-2 text-right">Amount</th>
                  <th className="px-5 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EDE9]">
                {st.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-5 py-2 text-muted">{dateTime(l.at)}</td>
                    <td className="px-5 py-2">
                      {l.description}
                      {l.reference && (
                        <span className="ml-2 font-mono text-xs text-muted">{l.reference}</span>
                      )}
                    </td>
                    <td
                      className={`px-5 py-2 text-right font-mono ${l.amountCents < 0 ? "" : "text-[#1B7F4B]"}`}
                    >
                      {rands(l.amountCents)}
                    </td>
                    <td className="px-5 py-2 text-right font-mono text-muted">
                      {rands(l.balanceAfterCents)}
                    </td>
                  </tr>
                ))}
                {st.lines.length === 0 && (
                  <tr>
                    <td colSpan={4} className="table-empty">
                      Nothing moved in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {st.outstandingCents > 0 && (
              <p className="panel-note text-sm">
                <span className="font-semibold">{rands(st.outstandingCents)}</span> is outstanding
                on your account.
              </p>
            )}
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="section-title">Documents</h2>
        {invoices.data?.length === 0 && (
          <p className="panel p-8 text-center text-sm text-muted">
            No invoices yet. One is issued for every booking once it has been delivered.
          </p>
        )}
        {invoices.data?.map((inv) => (
          <div key={inv.id} className="panel">
            <div className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm">
              <button
                onClick={() => setOpen(open === inv.id ? null : inv.id)}
                className="font-mono font-medium hover:underline"
              >
                {inv.number}
              </button>
              <span className="text-muted">{inv.kind.replace(/_/g, " ")}</span>
              <span className="text-muted">{inv.issuedAt ? dateOnly(inv.issuedAt) : "—"}</span>
              <span className="ml-auto font-mono">{rands(inv.totalCents)}</span>
              {inv.outstandingCents > 0 ? (
                <span className="chip chip-warn">{rands(inv.outstandingCents)} due</span>
              ) : (
                <span className="chip chip-good">
                  {inv.kind === "credit_note" ? "credited" : "paid"}
                </span>
              )}
            </div>
            {open === inv.id && (
              <div className="border-t border-line p-5">
                <InvoiceDocument invoice={inv} />
                <button
                  onClick={() => window.print()}
                  className="mt-4 btn btn-secondary btn-sm print:hidden"
                >
                  Print / save as PDF
                </button>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#FAFAF9] p-3">
      <div className="label-mini">{label}</div>
      <div className="mt-1 font-mono">{value}</div>
    </div>
  );
}

function defaultRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}
