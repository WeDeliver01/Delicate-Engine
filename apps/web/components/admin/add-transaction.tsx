"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ACCOUNT_TRANSACTIONS,
  type AccountTransactionType,
  type WalletEntry,
} from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { rands } from "@/lib/money";

/**
 * A movement on a customer's account, made by hand.
 *
 * Everything the business does to a balance outside the ordinary flow of top-ups and
 * deliveries: an EFT that arrived, a refund paid back, goodwill, a debt given up on. The
 * amount is always typed positive and the type decides which way it goes, because a debit
 * typed as a negative number is how somebody credits an account they meant to charge.
 *
 * The new balance is shown before anything is saved. This is somebody else's money and the
 * screen should say what is about to happen to it while there is still time to stop.
 */
export function AddTransaction({
  accountId,
  balanceCents,
  onDone,
}: {
  accountId: string;
  balanceCents: number;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AccountTransactionType | "">("");
  const [amount, setAmount] = useState("");
  const [waybill, setWaybill] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cents = Math.round(Number(amount.replace(",", ".")) * 100);
  const valid = Number.isFinite(cents) && cents > 0 && type !== "";
  const spec = type ? ACCOUNT_TRANSACTIONS[type] : null;
  const after =
    valid && spec ? balanceCents + (spec.direction === "credit" ? cents : -cents) : null;

  const save = useMutation({
    mutationFn: () =>
      api<WalletEntry>(`/v1/admin/accounts/${accountId}/transactions`, {
        method: "POST",
        json: {
          type,
          amountCents: cents,
          ...(waybill.trim() ? { waybill: waybill.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
        },
      }),
    onSuccess: () => {
      setType("");
      setAmount("");
      setWaybill("");
      setDescription("");
      setOpen(false);
      onDone();
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : String(e)),
  });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
        Add transaction
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-line p-4 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-ink">Add transaction</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="text-muted hover:text-ink"
        >
          ✕
        </button>
      </div>

      <label className="mt-3 block">
        <span className="field-label">Transaction type</span>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AccountTransactionType)}
          className="input mt-1"
        >
          <option value="">Select…</option>
          {(Object.keys(ACCOUNT_TRANSACTIONS) as AccountTransactionType[]).map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TRANSACTIONS[t].label}
              {ACCOUNT_TRANSACTIONS[t].direction === "credit" ? " (+)" : " (−)"}
            </option>
          ))}
        </select>
        {spec && <span className="field-hint">{spec.help}</span>}
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">
            Amount <span className="normal-case text-[#B5AFA7]">incl. VAT</span>
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="input mt-1 font-mono"
          />
        </label>
        <label className="block">
          <span className="field-label">
            Waybill <span className="normal-case text-[#B5AFA7]">optional</span>
          </span>
          <input
            value={waybill}
            onChange={(e) => setWaybill(e.target.value)}
            placeholder="DCW-0000412"
            className="input mt-1 font-mono"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="field-label">
          Description <span className="normal-case text-[#B5AFA7]">optional</span>
        </span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Why this is being done"
          className="input mt-1"
        />
      </label>

      {/* Said out loud before it happens, because this is somebody else's money. */}
      <p className="mt-4 text-sm">
        <span className="label-mini">New balance</span>{" "}
        <span className={`figure ml-2 text-base ${(after ?? 0) < 0 ? "text-[#C13B73]" : ""}`}>
          {after === null ? rands(balanceCents) : rands(after)}
        </span>
        {after !== null && after !== balanceCents && (
          <span className="ml-2 text-xs text-muted">
            was {rands(balanceCents)}, {spec?.direction === "credit" ? "up" : "down"} by{" "}
            {rands(cents)}
          </span>
        )}
      </p>

      {error && <p className="alert-error mt-3">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={!valid || save.isPending}
          onClick={() => {
            setError(null);
            save.mutate();
          }}
          className="btn btn-primary btn-sm"
        >
          {save.isPending ? "Saving…" : "Add transaction"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="link-quiet text-xs">
          Cancel
        </button>
        <span className="ml-auto text-xs text-muted">
          Recorded against your name and in the books.
        </span>
      </div>
    </div>
  );
}
