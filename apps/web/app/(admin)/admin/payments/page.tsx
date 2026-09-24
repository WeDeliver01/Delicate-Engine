"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PayablesSummary,
  PaymentProposal,
  ProposalKind,
  ProposalStatus,
} from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime, rands } from "@/lib/money";

interface FuelInstruction {
  instruction: { steps: string[]; proofRequired: string; portalUrl: string; automated: boolean };
}

const KIND_LABEL: Record<ProposalKind, string> = {
  driver_earnings_payout: "Driver earnings",
  driver_fuel_load: "Fuel card load",
  vendor_payment: "Vendor bill",
};

/**
 * Money out. The engine has worked out what is owed; a person decides, pays, and records the
 * proof. Nothing on this page pays anything by itself — that is the point.
 */
export default function AdminPayments() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProposalStatus | "">("");
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin"] });

  const payables = useQuery({
    queryKey: ["admin", "payments", "payables"],
    queryFn: () => api<PayablesSummary>("/v1/admin/payments/payables"),
    refetchInterval: 30_000,
  });
  const proposals = useQuery({
    queryKey: ["admin", "payments", "proposals", filter],
    queryFn: () =>
      api<PaymentProposal[]>(`/v1/admin/payments/proposals${filter ? `?status=${filter}` : ""}`),
    refetchInterval: 30_000,
  });

  const run = useMutation({
    mutationFn: (kind: ProposalKind) =>
      api<PaymentProposal[]>("/v1/admin/payments/runs", { method: "POST", json: { kind } }),
    onSuccess: (made) => {
      invalidate();
      if (made.length === 0)
        setError("Nothing new to propose — everything owed is already claimed.");
      else setError(null);
    },
    onError,
  });
  const sweep = useMutation({
    mutationFn: (body: { amountCents: number; reference: string }) =>
      api("/v1/admin/payments/bank-sweeps", { method: "POST", json: body }),
    onSuccess: invalidate,
    onError,
  });

  const p = payables.data;

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <header>
        <h1 className="text-2xl font-semibold">Payments</h1>
        <p className="text-sm text-[#86817A]">
          The engine proposes; you execute. A journal is posted only when you record that the money
          actually left.
        </p>
      </header>

      {p && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="In the bank" value={rands(p.bankBalanceCents)} />
          <Stat label="Awaiting bank sweep" value={rands(p.cashClearingCents)} />
          <Stat label="Owed to drivers" value={rands(p.driverEarningsOwedCents)} />
          <Stat label="Owed to fuel cards" value={rands(p.fuelCardOwedCents)} />
          <Stat label="Already committed" value={rands(p.committedCents)} tone="warn" />
        </section>
      )}

      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-[#ECEAE6] bg-white p-4">
        <span className="text-sm font-medium">Prepare a run:</span>
        {(Object.keys(KIND_LABEL) as ProposalKind[]).map((k) => (
          <button
            key={k}
            onClick={() => run.mutate(k)}
            disabled={run.isPending}
            className="rounded-full border border-[#DAD6CF] px-4 py-1.5 text-sm hover:border-[#0A0A0A] disabled:opacity-50"
          >
            {KIND_LABEL[k]}
          </button>
        ))}
        <span className="ml-auto text-xs text-[#86817A]">
          Writes proposals only. Never contacts a bank.
        </span>
      </section>

      {p && p.cashClearingCents > 0 && (
        <SweepCard
          clearingCents={p.cashClearingCents}
          pending={sweep.isPending}
          onSweep={(body) => sweep.mutate(body)}
        />
      )}

      <section className="rounded-xl border border-[#ECEAE6] bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#ECEAE6] px-5 py-4">
          <h2 className="font-semibold">Proposals</h2>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as ProposalStatus | "")}
            className="rounded-lg border border-[#DAD6CF] px-2 py-1 text-sm"
          >
            <option value="">all</option>
            {["proposed", "approved", "executed", "failed", "rejected", "cancelled"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <ul className="divide-y divide-[#F0EDE9]">
          {proposals.data?.map((row) => (
            <ProposalRow key={row.id} row={row} onDone={invalidate} onError={onError} />
          ))}
          {proposals.data?.length === 0 && (
            <li className="px-5 py-8 text-center text-[#86817A]">Nothing proposed.</li>
          )}
        </ul>
      </section>

      {p && p.vendors.length > 0 && (
        <section className="rounded-xl border border-[#ECEAE6] bg-white">
          <h2 className="border-b border-[#ECEAE6] px-5 py-4 font-semibold">Vendor bills</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-[#86817A]">
              <tr>
                <th className="px-5 py-2">Bill</th>
                <th className="px-5 py-2">Due</th>
                <th className="px-5 py-2 text-right">Amount</th>
                <th className="px-5 py-2 text-right">Saved</th>
                <th className="px-5 py-2">Payable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE9]">
              {p.vendors.map((v) => (
                <tr key={v.walletSlug}>
                  <td className="px-5 py-2">
                    {v.name}
                    <span className="ml-2 text-xs text-[#86817A]">{v.vendor}</span>
                  </td>
                  <td className="px-5 py-2">day {v.dueDay}</td>
                  <td className="px-5 py-2 text-right font-mono">{rands(v.amountCents)}</td>
                  <td className="px-5 py-2 text-right font-mono">{rands(v.fundedCents)}</td>
                  <td className="px-5 py-2">
                    {v.payable ? (
                      <span className="text-[#1B7F4B]">fully funded</span>
                    ) : (
                      <span className="text-[#86817A]">
                        short {rands(v.amountCents - v.fundedCents)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function ProposalRow({
  row,
  onDone,
  onError,
}: {
  row: PaymentProposal;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const act = useMutation({
    mutationFn: ({ path, json }: { path: string; json?: unknown }) =>
      api(`/v1/admin/payments/proposals/${row.id}/${path}`, { method: "POST", json: json ?? {} }),
    onSuccess: onDone,
    onError,
  });
  const fuel = useQuery({
    queryKey: ["admin", "payments", "fuel", row.id],
    queryFn: () =>
      api<FuelInstruction>(`/v1/admin/payments/proposals/${row.id}/fuel-load-instructions`),
    enabled: open && row.kind === "driver_fuel_load",
  });

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setOpen(!open)} className="font-mono text-sm hover:underline">
          {row.reference}
        </button>
        <span className="text-sm">{KIND_LABEL[row.kind]}</span>
        <span className="text-sm text-[#86817A]">{row.driverName ?? row.vendorName ?? "—"}</span>
        <span className="font-mono text-sm">{rands(row.amountCents)}</span>
        <StatusPill status={row.status} />
        <span className="ml-auto text-xs text-[#86817A]">{dateTime(row.createdAt)}</span>
      </div>

      {open && (
        <div className="mt-4 space-y-4 rounded-xl bg-[#FAFAF9] p-4 text-sm">
          <div>
            <div className="text-xs uppercase text-[#86817A]">Why this amount</div>
            <p className="mt-1">
              The ledger says {rands(row.basis.payableBalanceCents)} is owed
              {row.basis.walletSlug && ` and the ${row.basis.walletSlug} wallet has funded it`}.
            </p>
            {row.basis.note && <p className="mt-1 text-[#86817A]">{row.basis.note}</p>}
            {row.basis.items.length > 0 && (
              <table className="mt-2 w-full text-xs">
                <tbody>
                  {row.basis.items.map((i, n) => (
                    <tr key={n}>
                      <td className="py-0.5 font-mono">{i.waybill ?? "—"}</td>
                      <td className="py-0.5 text-[#86817A]">
                        {i.settledAt ? dateTime(i.settledAt) : ""}
                      </td>
                      <td className="py-0.5 text-right font-mono">{rands(i.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {fuel.data && (
            <div className="rounded-lg border border-[#DAD6CF] bg-white p-3">
              <div className="text-xs uppercase text-[#86817A]">
                How to load this card {fuel.data.instruction.automated ? "" : "(by hand)"}
              </div>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                {fuel.data.instruction.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-[#86817A]">
                Proof needed: {fuel.data.instruction.proofRequired}
              </p>
            </div>
          )}

          {row.status === "executed" ? (
            <p className="text-[#1B7F4B]">
              Paid {row.executedAt ? dateTime(row.executedAt) : ""} · proof{" "}
              <span className="font-mono">{row.externalReference}</span>
            </p>
          ) : row.status === "proposed" ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="note (optional)"
                className="flex-1 rounded-lg border border-[#DAD6CF] px-3 py-1.5"
              />
              <button
                onClick={() => act.mutate({ path: "approve", json: { note: note || undefined } })}
                className="rounded-full bg-[#0A0A0A] px-4 py-1.5 text-white hover:bg-[#E84A8A]"
              >
                Approve
              </button>
              <button
                onClick={() => act.mutate({ path: "reject", json: { note: note || undefined } })}
                className="rounded-full border border-[#DAD6CF] px-4 py-1.5 hover:border-[#0A0A0A]"
              >
                Reject
              </button>
            </div>
          ) : row.status === "approved" || row.status === "failed" ? (
            <div className="space-y-2">
              <p className="text-[#86817A]">
                Pay it, then record the proof here. This is what posts the journal.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="EFT / PayCentral reference"
                  className="flex-1 rounded-lg border border-[#DAD6CF] px-3 py-1.5 font-mono"
                />
                <button
                  disabled={reference.trim().length < 2}
                  onClick={() =>
                    act.mutate({ path: "execute", json: { externalReference: reference.trim() } })
                  }
                  className="rounded-full bg-[#0A0A0A] px-4 py-1.5 text-white hover:bg-[#E84A8A] disabled:opacity-40"
                >
                  I paid this
                </button>
                <button
                  onClick={() =>
                    act.mutate({
                      path: "fail",
                      json: { reason: note || "payment did not go through" },
                    })
                  }
                  className="rounded-full border border-[#DAD6CF] px-4 py-1.5 hover:border-[#0A0A0A]"
                >
                  Payment failed
                </button>
                <button
                  onClick={() => act.mutate({ path: "cancel", json: { note: note || undefined } })}
                  className="text-xs text-[#86817A] hover:underline"
                >
                  cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[#86817A]">
              {row.status}
              {row.decisionNote ? ` — ${row.decisionNote}` : ""}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function SweepCard({
  clearingCents,
  pending,
  onSweep,
}: {
  clearingCents: number;
  pending: boolean;
  onSweep: (body: { amountCents: number; reference: string }) => void;
}) {
  const [reference, setReference] = useState("");
  return (
    <section className="rounded-xl border border-[#ECEAE6] bg-white p-5">
      <h2 className="font-semibold">Bank sweep</h2>
      <p className="mt-1 text-sm text-[#86817A]">
        {rands(clearingCents)} of customer money is recorded as received but not yet confirmed in
        the bank. Record the sweep once the provider has settled.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="bank statement reference"
          className="flex-1 rounded-lg border border-[#DAD6CF] px-3 py-1.5 font-mono"
        />
        <button
          disabled={pending || reference.trim().length < 2}
          onClick={() => onSweep({ amountCents: clearingCents, reference: reference.trim() })}
          className="rounded-full bg-[#0A0A0A] px-5 py-1.5 text-white hover:bg-[#E84A8A] disabled:opacity-40"
        >
          Sweep {rands(clearingCents)}
        </button>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: ProposalStatus }) {
  const tone: Record<ProposalStatus, string> = {
    proposed: "bg-[#FDF3E3] text-[#8A5A12]",
    approved: "bg-[#EAF1FB] text-[#1F4E8C]",
    executed: "bg-[#E7F5EC] text-[#1B7F4B]",
    failed: "bg-[#FCEEF4] text-[#C13B73]",
    rejected: "bg-[#F0EDE9] text-[#6B6661]",
    cancelled: "bg-[#F0EDE9] text-[#6B6661]",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${tone[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-[#ECEAE6] bg-white p-4">
      <div className="text-xs uppercase text-[#86817A]">{label}</div>
      <div className={`mt-1 font-mono text-lg ${tone === "warn" ? "text-[#C13B73]" : ""}`}>
        {value}
      </div>
    </div>
  );
}
