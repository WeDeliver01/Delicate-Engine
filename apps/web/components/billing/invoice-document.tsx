"use client";

import type { Invoice } from "@delicate/contracts";
import { dateOnly, rands } from "@/lib/money";

/**
 * The printable document. Everything shown here comes from the invoice row's own snapshot, not
 * from live settings — a reprint years later must show what was true at issue.
 *
 * `print:` classes strip the page chrome so Ctrl-P produces something a bookkeeper will accept;
 * that is deliberately all the "PDF export" this needs.
 */
export function InvoiceDocument({ invoice }: { invoice: Invoice }) {
  const isCredit = invoice.kind === "credit_note";
  const title = isCredit
    ? "CREDIT NOTE"
    : invoice.kind === "tax_invoice"
      ? "TAX INVOICE"
      : "INVOICE";
  const sign = (cents: number) => rands(isCredit ? -Math.abs(cents) : cents);

  return (
    <article className="rounded-xl border border-[#ECEAE6] bg-white p-6 text-sm print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="text-lg font-semibold">{invoice.supplier.legalName}</div>
          {invoice.supplier.tradingName &&
            invoice.supplier.tradingName !== invoice.supplier.legalName && (
              <div className="text-[#86817A]">t/a {invoice.supplier.tradingName}</div>
            )}
          <div className="mt-1 whitespace-pre-line text-[#6B6661]">
            {invoice.supplier.address.formatted}
          </div>
          <div className="mt-1 text-[#6B6661]">
            {invoice.supplier.email} · {invoice.supplier.phone}
          </div>
          {invoice.supplier.registrationNumber && (
            <div className="text-[#86817A]">Reg no. {invoice.supplier.registrationNumber}</div>
          )}
          {invoice.supplier.vatNumber && (
            <div className="text-[#86817A]">VAT no. {invoice.supplier.vatNumber}</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold tracking-wide">{title}</div>
          <div className="mt-1 font-mono">{invoice.number}</div>
          <div className="text-[#86817A]">
            {invoice.issuedAt ? dateOnly(invoice.issuedAt) : "not issued"}
          </div>
          {invoice.dueAt && <div className="text-[#86817A]">Due {dateOnly(invoice.dueAt)}</div>}
          {invoice.period && <div className="text-[#86817A]">Period {invoice.period}</div>}
          {invoice.status === "void" && (
            <div className="mt-1 font-semibold text-[#C13B73]">VOID — credited</div>
          )}
        </div>
      </header>

      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <div className="text-xs uppercase text-[#86817A]">Billed to</div>
          <div className="mt-1 font-medium">
            {invoice.billTo.legalName ?? invoice.billTo.accountName}
          </div>
          {invoice.billTo.legalName && (
            <div className="text-[#6B6661]">{invoice.billTo.accountName}</div>
          )}
          {invoice.billTo.address && (
            <div className="text-[#6B6661]">{invoice.billTo.address.formatted}</div>
          )}
          {invoice.billTo.email && <div className="text-[#6B6661]">{invoice.billTo.email}</div>}
          {invoice.billTo.vatNumber && (
            <div className="text-[#86817A]">VAT no. {invoice.billTo.vatNumber}</div>
          )}
        </div>
        {invoice.supplier.bank.accountNumber && (
          <div>
            <div className="text-xs uppercase text-[#86817A]">Banking details</div>
            <div className="mt-1 text-[#6B6661]">
              {invoice.supplier.bank.bankName} · {invoice.supplier.bank.accountName}
            </div>
            <div className="font-mono text-[#6B6661]">
              {invoice.supplier.bank.accountNumber} · branch {invoice.supplier.bank.branchCode}
            </div>
            <div className="mt-1 text-xs text-[#86817A]">Reference: {invoice.number}</div>
          </div>
        )}
      </section>

      <table className="mt-6 w-full text-left">
        <thead className="border-b border-[#ECEAE6] text-xs uppercase text-[#86817A]">
          <tr>
            <th className="py-2">Description</th>
            <th className="py-2">Waybill</th>
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 text-right">Excl. VAT</th>
            <th className="py-2 text-right">VAT</th>
            <th className="py-2 text-right">Incl. VAT</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F0EDE9]">
          {invoice.lines.map((l, i) => (
            <tr key={i}>
              <td className="py-2">{l.description}</td>
              <td className="py-2 font-mono text-xs">{l.waybill ?? "—"}</td>
              <td className="py-2 text-right">{l.quantity}</td>
              <td className="py-2 text-right font-mono">{rands(l.netCents)}</td>
              <td className="py-2 text-right font-mono">{rands(l.vatCents)}</td>
              <td className="py-2 text-right font-mono">{rands(l.grossCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <dl className="w-64 space-y-1">
          <Row k="Subtotal (excl. VAT)" v={sign(Math.abs(invoice.netCents))} />
          {invoice.vatCents !== 0 && (
            <Row
              k={`VAT (${((invoice.lines[0]?.vatBps ?? 0) / 100).toFixed(0)}%)`}
              v={sign(Math.abs(invoice.vatCents))}
            />
          )}
          <Row k="Total" v={sign(Math.abs(invoice.totalCents))} strong />
          {invoice.outstandingCents > 0 ? (
            <Row k="Outstanding" v={rands(invoice.outstandingCents)} strong />
          ) : (
            !isCredit && <Row k="Paid" v="in full" />
          )}
        </dl>
      </div>

      {invoice.note && <p className="mt-4 text-[#6B6661]">{invoice.note}</p>}
      {invoice.vatCents === 0 && !isCredit && (
        <p className="mt-4 text-xs text-[#86817A]">
          No VAT charged: the supplier is not registered for VAT.
        </p>
      )}
    </article>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-6">
      <dt className="text-[#86817A]">{k}</dt>
      <dd className={`font-mono ${strong ? "font-semibold" : ""}`}>{v}</dd>
    </div>
  );
}
