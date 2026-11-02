"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AccountRateAssignment, RateCard } from "@delicate/contracts";
import { api } from "@/lib/api";
import { dateOnly } from "@/lib/money";
import { Chip, Field, Panel } from "@/components/ui";
import { AccountPicker, type PickableAccount } from "@/components/admin/account-picker";
import {
  leverForm,
  leversToPayload,
  PRICE_FORMULA,
  RateLevers,
  type LeverForm,
} from "@/components/admin/rate-levers";

/**
 * A card written for one customer.
 *
 * No draft step, unlike a group: this is the deal just agreed on the phone, and saving it is
 * the decision. It beats the customer's rate group and the house default, so it is also the
 * thing to look at first when a price is queried — which is why the list says plainly who is
 * on one.
 */
export function AccountRates({
  assignments,
  defaultCard,
  onSaved,
  onError,
}: {
  assignments: AccountRateAssignment[];
  defaultCard: RateCard | null;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [picked, setPicked] = useState<PickableAccount | null>(null);
  const [adding, setAdding] = useState(false);

  const remove = useMutation({
    mutationFn: (accountId: string) =>
      api(`/v1/admin/rates/accounts/${accountId}/card`, { method: "DELETE" }),
    onSuccess: onSaved,
    onError,
  });

  return (
    <Panel
      title="Rates for one account"
      description="A negotiated card for a single customer."
      actions={
        <button
          onClick={() => {
            setAdding((v) => !v);
            setPicked(null);
          }}
          className="btn btn-secondary btn-sm"
        >
          {adding ? "Cancel" : "New account rates"}
        </button>
      }
      footer="Taking the card off puts the account back on its rate group, or on the house default if it is in none. Quotes already priced keep the numbers they were priced on."
    >
      {adding && (
        <div className="border-b border-line px-5 py-4 sm:px-6">
          {picked ? (
            <AccountCardEditor
              account={picked}
              defaultCard={defaultCard}
              onDone={() => {
                setPicked(null);
                setAdding(false);
                onSaved();
              }}
              onBack={() => setPicked(null)}
              onError={onError}
            />
          ) : (
            <div className="max-w-md">
              <Field label="Which customer">
                <AccountPicker onPick={setPicked} />
              </Field>
            </div>
          )}
        </div>
      )}

      {assignments.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted sm:px-6">
          No account is on its own card. Everyone is on the house rates or a rate group.
        </div>
      ) : (
        <table className="table-base">
          <thead>
            <tr>
              <th>Account</th>
              <th>Card</th>
              <th>Per km</th>
              <th>Margin</th>
              <th>Minimum</th>
              <th>Since</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.accountId}>
                <td>
                  {a.accountName}
                  <span className="ml-2 font-mono text-xs text-muted">{a.accountCode}</span>
                </td>
                <td>
                  {a.rateCard.name}
                  {a.rateCard.scope === "platform" && (
                    <>
                      {" "}
                      <Chip tone="info">house card</Chip>
                    </>
                  )}
                </td>
                <td className="font-mono">R{(a.rateCard.costPerKmCents / 100).toFixed(2)}</td>
                <td className="font-mono">{(a.rateCard.marginBps / 100).toFixed(1)}%</td>
                <td className="font-mono">R{(a.rateCard.minFeeCents / 100).toFixed(2)}</td>
                <td className="text-xs text-muted">{dateOnly(a.assignedAt)}</td>
                <td className="text-right">
                  <button
                    onClick={() => remove.mutate(a.accountId)}
                    disabled={remove.isPending}
                    className="link-quiet text-xs"
                  >
                    Take off
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function AccountCardEditor({
  account,
  defaultCard,
  onDone,
  onBack,
  onError,
}: {
  account: PickableAccount;
  defaultCard: RateCard | null;
  onDone: () => void;
  onBack: () => void;
  onError: (e: unknown) => void;
}) {
  const [form, setForm] = useState<LeverForm>(leverForm(defaultCard));
  const [name, setName] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api<RateCard>(`/v1/admin/rates/accounts/${account.id}/card`, {
        method: "POST",
        json: { ...leversToPayload(form), ...(name.trim() ? { name: name.trim() } : {}) },
      }),
    onSuccess: onDone,
    onError,
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          Rates for <span className="font-semibold text-ink">{account.name}</span>{" "}
          <span className="font-mono text-xs text-muted">{account.code}</span>
        </p>
        <button onClick={onBack} className="link-quiet text-xs">
          Choose a different account
        </button>
      </div>
      <div className="mt-3 max-w-md">
        <Field label="Card name" hint="Left blank, it is named after the account.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${account.name} rates`}
            className="input"
          />
        </Field>
      </div>
      <div className="mt-4">
        <RateLevers form={form} onChange={setForm} />
      </div>
      <p className="mt-3 text-xs text-muted">{PRICE_FORMULA}</p>
      <p className="mt-1 text-xs text-muted">
        Saving puts this card on the account immediately — it is live, and it beats any rate group
        the account is in.
      </p>
      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="btn btn-primary btn-sm mt-3"
      >
        Save and apply
      </button>
    </div>
  );
}
