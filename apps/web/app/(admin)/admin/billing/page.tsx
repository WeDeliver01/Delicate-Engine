"use client";

import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgeingBucket, Invoice } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateOnly, rands } from "@/lib/money";
import { InvoiceDocument } from "@/components/billing/invoice-document";

/** Finance view of billing: run the month, credit mistakes, take payments, watch the ageing. */
export default function AdminBilling() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState(lastMonth());
  const [open, setOpen] = useState<string | null>(null);
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin"] });

  const invoices = useQuery({
    queryKey: ["admin", "billing", "invoices"],
    queryFn: () => api<Invoice[]>("/v1/admin/billing/invoices?limit=100"),
    refetchInterval: 60_000,
  });
  const ageing = useQuery({
    queryKey: ["admin", "billing", "ageing"],
    queryFn: () => api<AgeingBucket[]>("/v1/admin/billing/ageing"),
    refetchInterval: 60_000,
  });
  const run = useMutation({
    mutationFn: () =>
      api<Invoice[]>("/v1/admin/billing/monthly-runs", { method: "POST", json: { period } }),
    onSuccess: (made) => {
      invalidate();
      setError(made.length === 0 ? `No postpaid deliveries to invoice for ${period}.` : null);
    },
    onError,
  });

  const owed = ageing.data?.reduce((s, r) => s + r.totalCents, 0) ?? 0;

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Billing</h1>
          <p className="text-sm text-[#86817A]">
            Prepaid bookings invoice themselves as they settle. Postpaid accounts are billed here,
            monthly.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="YYYY-MM"
            className="w-28 rounded-lg border border-[#DAD6CF] px-3 py-1.5 font-mono"
          />
          <button
            onClick={() => run.mutate()}
            disabled={run.isPending || !/^\d{4}-\d{2}$/.test(period)}
            className="rounded-full bg-[#0A0A0A] px-5 py-1.5 text-white hover:bg-[#E84A8A] disabled:opacity-40"
          >
            {run.isPending ? "Running…" : "Run monthly billing"}
          </button>
        </div>
      </header>

      <section className="rounded-xl border border-[#ECEAE6] bg-white">
        <div className="flex items-center justify-between border-b border-[#ECEAE6] px-5 py-4">
          <h2 className="font-semibold">Ageing</h2>
          <span className="font-mono text-sm">{rands(owed)} outstanding</span>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-[#86817A]">
            <tr>
              <th className="px-5 py-2">Account</th>
              <th className="px-5 py-2 text-right">Current</th>
              <th className="px-5 py-2 text-right">1–30 days</th>
              <th className="px-5 py-2 text-right">31–60</th>
              <th className="px-5 py-2 text-right">60+</th>
              <th className="px-5 py-2 text-right">Total</th>
              <th className="px-5 py-2">Limit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EDE9]">
            {ageing.data?.map((r) => (
              <tr key={r.accountId}>
                <td className="px-5 py-2">{r.accountName}</td>
                <td className="px-5 py-2 text-right font-mono">{rands(r.currentCents)}</td>
                <td className="px-5 py-2 text-right font-mono">{rands(r.days30Cents)}</td>
                <td className="px-5 py-2 text-right font-mono">{rands(r.days60Cents)}</td>
                <td className="px-5 py-2 text-right font-mono text-[#C13B73]">
                  {rands(r.days90PlusCents)}
                </td>
                <td className="px-5 py-2 text-right font-mono font-semibold">
                  {rands(r.totalCents)}
                </td>
                <td className="px-5 py-2">
                  {r.overLimit ? (
                    <span className="rounded-full bg-[#FCEEF4] px-2 py-0.5 text-xs text-[#C13B73]">
                      over {rands(r.creditLimitCents)}
                    </span>
                  ) : (
                    <span className="text-xs text-[#86817A]">
                      within {rands(r.creditLimitCents)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {ageing.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-[#86817A]">
                  Nobody owes anything. Good day.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-[#ECEAE6] bg-white">
        <h2 className="border-b border-[#ECEAE6] px-5 py-4 font-semibold">Documents</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-[#86817A]">
            <tr>
              <th className="px-5 py-2">Number</th>
              <th className="px-5 py-2">Kind</th>
              <th className="px-5 py-2">Issued</th>
              <th className="px-5 py-2">Due</th>
              <th className="px-5 py-2 text-right">Total</th>
              <th className="px-5 py-2 text-right">Outstanding</th>
              <th className="px-5 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EDE9]">
            {invoices.data?.map((inv) => (
              <Fragment key={inv.id}>
                <tr>
                  <td className="px-5 py-2">
                    <button
                      onClick={() => setOpen(open === inv.id ? null : inv.id)}
                      className="font-mono hover:underline"
                    >
                      {inv.number}
                    </button>
                  </td>
                  <td className="px-5 py-2 text-[#86817A]">{inv.kind.replace(/_/g, " ")}</td>
                  <td className="px-5 py-2">{inv.issuedAt ? dateOnly(inv.issuedAt) : "—"}</td>
                  <td className="px-5 py-2">{inv.dueAt ? dateOnly(inv.dueAt) : "—"}</td>
                  <td className="px-5 py-2 text-right font-mono">{rands(inv.totalCents)}</td>
                  <td className="px-5 py-2 text-right font-mono">
                    {inv.outstandingCents > 0 ? rands(inv.outstandingCents) : "—"}
                  </td>
                  <td className="px-5 py-2">{inv.status}</td>
                </tr>
                {open === inv.id && (
                  <tr>
                    <td colSpan={7} className="bg-[#FAFAF9] px-5 py-4">
                      <Detail invoice={inv} onDone={invalidate} onError={onError} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {invoices.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-[#86817A]">
                  No documents yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Detail({
  invoice,
  onDone,
  onError,
}: {
  invoice: Invoice;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [payRef, setPayRef] = useState("");

  const credit = useMutation({
    mutationFn: () =>
      api(`/v1/admin/billing/invoices/${invoice.id}/credit-notes`, {
        method: "POST",
        json: {
          reason,
          amountCents: amount ? Math.round(Number(amount) * 100) : undefined,
        },
      }),
    onSuccess: onDone,
    onError,
  });
  const pay = useMutation({
    mutationFn: () =>
      api(`/v1/admin/billing/invoices/${invoice.id}/payments`, {
        method: "POST",
        json: { amountCents: invoice.outstandingCents, reference: payRef },
      }),
    onSuccess: onDone,
    onError,
  });

  return (
    <div className="space-y-4">
      <InvoiceDocument invoice={invoice} />

      {invoice.outstandingCents > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            value={payRef}
            onChange={(e) => setPayRef(e.target.value)}
            placeholder="payment reference"
            className="flex-1 rounded-lg border border-[#DAD6CF] px-3 py-1.5 font-mono"
          />
          <button
            disabled={payRef.trim().length < 2}
            onClick={() => pay.mutate()}
            className="rounded-full bg-[#0A0A0A] px-4 py-1.5 text-white hover:bg-[#E84A8A] disabled:opacity-40"
          >
            Record {rands(invoice.outstandingCents)} received
          </button>
        </div>
      )}

      {invoice.kind !== "credit_note" && !invoice.creditedByInvoiceId && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="reason for the credit note"
            className="flex-1 rounded-lg border border-[#DAD6CF] px-3 py-1.5"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="rands (blank = full)"
            className="w-36 rounded-lg border border-[#DAD6CF] px-3 py-1.5 font-mono"
          />
          <button
            disabled={reason.trim().length < 3}
            onClick={() => credit.mutate()}
            className="rounded-full border border-[#DAD6CF] px-4 py-1.5 hover:border-[#0A0A0A] disabled:opacity-40"
          >
            Issue credit note
          </button>
        </div>
      )}
      {invoice.creditedByInvoiceId && (
        <p className="text-sm text-[#86817A]">
          Already credited. An issued document is never edited.
        </p>
      )}
    </div>
  );
}

function lastMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
