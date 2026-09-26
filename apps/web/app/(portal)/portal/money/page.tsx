"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DateRange } from "@delicate/contracts";
import { useMe } from "@/components/use-me";
import { api } from "@/lib/api";
import { rands } from "@/lib/money";
import { PeriodPicker, periodRange, type PeriodState } from "@/components/shell/period-picker";

type MoneyEventKind =
  | "topup"
  | "charge"
  | "refund"
  | "adjustment"
  | "cashback"
  | "statement_payment"
  | "invoice"
  | "hold"
  | "hold_released";

interface MoneyEvent {
  id: string;
  kind: MoneyEventKind;
  at: string;
  description: string;
  reference: string | null;
  amountCents: number;
  balanceAfterCents: number | null;
  status: string | null;
  href: string | null;
}

interface MoneyTimeline {
  range: DateRange;
  totals: {
    inCents: number;
    outCents: number;
    cashbackCents: number;
    invoicedCents: number;
    heldCents: number;
  };
  events: MoneyEvent[];
}

const LABELS: Record<MoneyEventKind, string> = {
  topup: "Top-up",
  charge: "Delivery charge",
  refund: "Refund",
  adjustment: "Adjustment",
  cashback: "Cashback",
  statement_payment: "Statement payment",
  invoice: "Invoice",
  hold: "Reserved",
  hold_released: "Reservation ended",
};

/**
 * Every time money moved, in one list.
 *
 * The parts were already here — the wallet, the invoices, the rewards — but each on its own
 * page, so "where did last month go" meant three tabs and a subtraction. This is the statement
 * that answers it in one place. It lists rather than recalculates: the wallet ledger stays the
 * only account of the balance, so this can never disagree with it.
 */
export default function MoneyPage() {
  const me = useMe();
  const [period, setPeriod] = useState<PeriodState>({ key: "this_month", from: null, to: null });
  const [kinds, setKinds] = useState<MoneyEventKind[]>([]);
  const range = periodRange(period);

  const money = useQuery({
    queryKey: ["account", me.activeAccount?.id, "money", period.key, range.from, range.to],
    queryFn: () =>
      api<MoneyTimeline>(
        `/v1/account/dashboard/money?period=${period.key}&from=${range.from}&to=${range.to}`,
      ),
    enabled: !!me.activeAccount,
  });

  const d = money.data;
  const shown = d?.events.filter((e) => !kinds.length || kinds.includes(e.kind)) ?? [];
  const present = [...new Set(d?.events.map((e) => e.kind) ?? [])];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{me.activeAccount?.name}</p>
          <h1 className="page-title mt-1">Money</h1>
          <p className="lede mt-1">
            Every top-up, charge, refund, invoice and reward, in the order it happened.
          </p>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Total label="Paid in" value={d?.totals.inCents} tone="good" />
        <Total label="Spent" value={d?.totals.outCents} tone="spend" />
        <Total label="Cashback earned" value={d?.totals.cashbackCents} tone="good" />
        <Total label="Invoiced" value={d?.totals.invoicedCents} />
        <Total
          label="Reserved right now"
          value={d?.totals.heldCents}
          hint="held against deliveries in progress"
        />
      </section>

      {present.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {present.map((k) => {
            const on = kinds.includes(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKinds(on ? kinds.filter((x) => x !== k) : [...kinds, k])}
                className={`chip transition-colors ${
                  on ? "bg-ink text-white" : "chip-outline hover:border-ink hover:text-ink"
                }`}
              >
                {LABELS[k]}
              </button>
            );
          })}
          {!!kinds.length && (
            <button type="button" onClick={() => setKinds([])} className="link-quiet text-xs">
              Show everything
            </button>
          )}
        </div>
      )}

      {money.isLoading ? (
        <div className="panel">
          <p className="table-empty">Loading…</p>
        </div>
      ) : !shown.length ? (
        <div className="panel">
          <p className="table-empty">Nothing moved in this period.</p>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Reference</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Wallet after</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={`${e.kind}-${e.id}`} className="transition-colors hover:bg-[#FAFAF9]">
                  <td className="whitespace-nowrap text-[#6B6661]">
                    {new Date(e.at).toLocaleDateString("en-ZA", {
                      day: "numeric",
                      month: "short",
                    })}
                    <span className="block text-xs text-muted">
                      {new Date(e.at).toLocaleTimeString("en-ZA", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </td>
                  <td>
                    <span className="block">{e.description}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className="chip chip-neutral">{LABELS[e.kind]}</span>
                      {e.status === "unpaid" && <span className="chip chip-warn">Unpaid</span>}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-[#6B6661]">{e.reference ?? "—"}</td>
                  <td className="text-right">
                    {e.amountCents === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span
                        className={`figure font-medium ${
                          e.amountCents > 0 ? "text-[#1B7F4B]" : "text-ink"
                        }`}
                      >
                        {e.amountCents > 0 ? "+" : "−"}
                        {rands(Math.abs(e.amountCents))}
                      </span>
                    )}
                  </td>
                  <td className="figure text-right text-[#6B6661]">
                    {e.balanceAfterCents != null ? rands(e.balanceAfterCents) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted">
        A reservation is not a charge: the money stays yours until the delivery is completed, and is
        released in full if you cancel before collection. See{" "}
        <Link href="/portal/wallet" className="link-accent">
          your wallet
        </Link>{" "}
        for the running balance and{" "}
        <Link href="/portal/invoices" className="link-accent">
          invoices
        </Link>{" "}
        for the tax documents.
      </p>
    </div>
  );
}

function Total({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value?: number;
  tone?: "good" | "spend";
  hint?: string;
}) {
  return (
    <div className="panel p-5">
      <p className="label-mini">{label}</p>
      <p
        className={`figure mt-1 text-xl font-semibold ${
          tone === "good" ? "text-[#1B7F4B]" : "text-ink"
        }`}
      >
        {value != null ? rands(value) : "—"}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
