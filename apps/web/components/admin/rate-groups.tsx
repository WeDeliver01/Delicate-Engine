"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { RateCard, RateGroup } from "@delicate/contracts";
import { api } from "@/lib/api";
import { dateOnly } from "@/lib/money";
import { Chip, Field, Panel } from "@/components/ui";
import { AccountPicker } from "@/components/admin/account-picker";
import {
  leverForm,
  leversToPayload,
  PRICE_FORMULA,
  RateLevers,
  type LeverForm,
} from "@/components/admin/rate-levers";

/**
 * Rate groups: a named set of accounts priced by their own rules.
 *
 * The shape of the screen follows the shape of the decision. A group is made, accounts are
 * put in it, rates are drafted, and then somebody publishes them — four separate acts, so
 * nothing a half-finished group holds can reach a customer's invoice. The switch at the top
 * is the brake: off, every member goes back to the house default and the deal stays on file.
 */
export function RateGroups({
  groups,
  defaultCard,
  onSaved,
  onError,
}: {
  groups: RateGroup[];
  defaultCard: RateCard | null;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api<RateGroup>("/v1/admin/rates/groups", {
        method: "POST",
        json: { name, description: description.trim() || null },
      }),
    onSuccess: () => {
      setName("");
      setDescription("");
      setCreating(false);
      onSaved();
    },
    onError,
  });

  return (
    <Panel
      title="Rate groups"
      description="A set of accounts on their own rules. New groups start switched off."
      actions={
        <button onClick={() => setCreating((v) => !v)} className="btn btn-secondary btn-sm">
          {creating ? "Cancel" : "New group"}
        </button>
      }
      footer="An account belongs to one group at a time, so there is always exactly one answer to which rules price its work. A card written for that one account still beats its group."
    >
      {creating && (
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Group name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sweet Co franchises"
                className="input"
                autoFocus
              />
            </Field>
            <Field label="What this group is" hint="For whoever reads it next year.">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Negotiated March 2026, reviewed annually"
                className="input"
              />
            </Field>
          </div>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending || name.trim().length < 2}
            className="btn btn-primary btn-sm mt-3"
          >
            Create group
          </button>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted sm:px-6">
          No rate groups yet. Every account is on the house rates or its own card.
        </div>
      ) : (
        <div className="divide-y divide-line">
          {groups.map((g) => (
            <GroupRow
              key={g.id}
              group={g}
              defaultCard={defaultCard}
              onSaved={onSaved}
              onError={onError}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function GroupRow({
  group,
  defaultCard,
  onSaved,
  onError,
}: {
  group: RateGroup;
  defaultCard: RateCard | null;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

  const base = `/v1/admin/rates/groups/${group.id}`;

  const setActive = useMutation({
    mutationFn: () => api(`${base}/active`, { method: "PUT", json: { active: !group.active } }),
    onSuccess: onSaved,
    onError,
  });
  const addMember = useMutation({
    mutationFn: (accountId: string) =>
      api(`${base}/members`, { method: "POST", json: { accountIds: [accountId] } }),
    onSuccess: onSaved,
    onError,
  });
  const removeMember = useMutation({
    mutationFn: (accountId: string) => api(`${base}/members/${accountId}`, { method: "DELETE" }),
    onSuccess: onSaved,
    onError,
  });
  const publish = useMutation({
    mutationFn: (cardId: string) => api(`${base}/cards/${cardId}/publish`, { method: "POST" }),
    onSuccess: onSaved,
    onError,
  });

  return (
    <div className="px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 text-left font-display text-base font-bold text-ink"
          >
            <span className="material-symbols-outlined text-[18px] text-muted" aria-hidden="true">
              {open ? "expand_more" : "chevron_right"}
            </span>
            {group.name}
          </button>
          <p className="mt-1 text-xs text-muted">
            {group.description ? `${group.description} · ` : ""}
            {group.members.length === 1 ? "1 account" : `${group.members.length} accounts`}
            {group.liveRateCard
              ? ` · live on ${group.liveRateCard.name}`
              : " · no rates published yet"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {group.active ? <Chip tone="good">Live</Chip> : <Chip tone="neutral">Off</Chip>}
          <button
            onClick={() => setActive.mutate()}
            disabled={setActive.isPending || (!group.active && !group.liveRateCard)}
            title={
              !group.active && !group.liveRateCard
                ? "Publish rates for this group before switching it on"
                : undefined
            }
            className={`btn btn-sm ${group.active ? "btn-danger" : "btn-primary"}`}
          >
            {group.active ? "Switch off" : "Switch on"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          {/* Members */}
          <div className="rounded-xl border border-line">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h3 className="text-sm font-semibold text-ink">Accounts in this group</h3>
              <button onClick={() => setAdding((v) => !v)} className="btn btn-secondary btn-sm">
                {adding ? "Done" : "Add account"}
              </button>
            </div>
            {adding && (
              <div className="border-b border-line px-4 py-3">
                <AccountPicker
                  exclude={group.members.map((m) => m.accountId)}
                  onPick={(a) => addMember.mutate(a.id)}
                />
                <p className="mt-2 text-xs text-muted">
                  An account already in another group is moved to this one.
                </p>
              </div>
            )}
            {group.members.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">
                Nobody in this group yet, so its rates charge nobody.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {group.members.map((m) => (
                  <li
                    key={m.accountId}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <span>
                      {m.accountName}{" "}
                      <span className="font-mono text-xs text-muted">{m.accountCode}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-muted">added {dateOnly(m.addedAt)}</span>
                      <button
                        onClick={() => removeMember.mutate(m.accountId)}
                        disabled={removeMember.isPending}
                        className="link-quiet text-xs"
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Rates */}
          <div className="rounded-xl border border-line">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h3 className="text-sm font-semibold text-ink">Rates</h3>
              <button onClick={() => setDrafting((v) => !v)} className="btn btn-secondary btn-sm">
                {drafting ? "Cancel" : "Draft new rates"}
              </button>
            </div>

            {drafting && (
              <GroupCardEditor
                title="New rates, starting from the house card"
                initial={leverForm(defaultCard)}
                submitLabel="Save as draft"
                onSubmit={(body) => api<RateCard>(`${base}/cards`, { method: "POST", json: body })}
                onDone={() => {
                  setDrafting(false);
                  onSaved();
                }}
                onError={onError}
              />
            )}

            {group.liveRateCard &&
              (editing === group.liveRateCard.id ? (
                <GroupCardEditor
                  title={`Editing ${group.liveRateCard.name} — these numbers are charging people now`}
                  initial={leverForm(group.liveRateCard)}
                  name={group.liveRateCard.name}
                  submitLabel="Save live rates"
                  onSubmit={(body) =>
                    api<RateCard>(`${base}/cards/${group.liveRateCard!.id}`, {
                      method: "PUT",
                      json: body,
                    })
                  }
                  onDone={() => {
                    setEditing(null);
                    onSaved();
                  }}
                  onError={onError}
                />
              ) : (
                <CardLine
                  card={group.liveRateCard}
                  tone="good"
                  label="Live"
                  onEdit={() => setEditing(group.liveRateCard!.id)}
                />
              ))}

            {group.draftRateCards.map((c) =>
              editing === c.id ? (
                <GroupCardEditor
                  key={c.id}
                  title={`Editing draft ${c.name}`}
                  initial={leverForm(c)}
                  name={c.name}
                  submitLabel="Save draft"
                  onSubmit={(body) =>
                    api<RateCard>(`${base}/cards/${c.id}`, { method: "PUT", json: body })
                  }
                  onDone={() => {
                    setEditing(null);
                    onSaved();
                  }}
                  onError={onError}
                />
              ) : (
                <CardLine
                  key={c.id}
                  card={c}
                  tone="neutral"
                  label="Draft"
                  onEdit={() => setEditing(c.id)}
                  onPublish={() => publish.mutate(c.id)}
                  publishing={publish.isPending}
                />
              ),
            )}

            {!group.liveRateCard && group.draftRateCards.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted">
                No rates for this group yet. Draft some, then publish them to go live.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CardLine({
  card,
  tone,
  label,
  onEdit,
  onPublish,
  publishing,
}: {
  card: RateCard;
  tone: "good" | "neutral";
  label: string;
  onEdit: () => void;
  onPublish?: () => void;
  publishing?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <div className="text-sm">
        <Chip tone={tone}>{label}</Chip> <span className="font-medium text-ink">{card.name}</span>
        <span className="ml-2 font-mono text-xs text-muted">
          R{(card.costPerKmCents / 100).toFixed(2)}/km · {(card.marginBps / 100).toFixed(1)}% margin
          · min R{(card.minFeeCents / 100).toFixed(2)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onEdit} className="btn btn-secondary btn-sm">
          Edit
        </button>
        {onPublish && (
          <button
            onClick={onPublish}
            disabled={publishing}
            className="btn btn-primary btn-sm"
            title="Makes these the group's rules and retires the card they replace"
          >
            Go live
          </button>
        )}
      </div>
    </div>
  );
}

function GroupCardEditor({
  title,
  initial,
  name: initialName,
  submitLabel,
  onSubmit,
  onDone,
  onError,
}: {
  title: string;
  initial: LeverForm;
  name?: string;
  submitLabel: string;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const [form, setForm] = useState(initial);
  const [name, setName] = useState(initialName ?? "");
  const save = useMutation({
    mutationFn: () =>
      onSubmit({ ...leversToPayload(form), ...(name.trim() ? { name: name.trim() } : {}) }),
    onSuccess: onDone,
    onError,
  });

  return (
    <div className="border-b border-line bg-[#FBFAF8] px-4 py-4 last:border-b-0">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <div className="mt-3 max-w-md">
        <Field label="Card name" hint="Left blank, it is named after the group.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sweet Co franchises rates"
            className="input"
          />
        </Field>
      </div>
      <div className="mt-4">
        <RateLevers form={form} onChange={setForm} />
      </div>
      <p className="mt-3 text-xs text-muted">{PRICE_FORMULA}</p>
      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="btn btn-primary btn-sm mt-3"
      >
        {submitLabel}
      </button>
    </div>
  );
}
