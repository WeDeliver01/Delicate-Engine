"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountRateAssignment, RateCard, RateGroup } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { useMe } from "@/components/use-me";
import { Chip, Field, Notice, PageHeader, Panel, Toggle } from "@/components/ui";
import { AccountRates } from "@/components/admin/account-rates";
import { RateGroups } from "@/components/admin/rate-groups";
import {
  describeRateIssue,
  leverForm,
  leversToPayload,
  PRICE_FORMULA,
  RateLevers,
  type LeverForm,
} from "@/components/admin/rate-levers";

/**
 * Rates. Super admin only, on the engine and here.
 *
 * Three things can price a booking and the page is in the order they are tried: the card
 * written for that one account, then the live card of the rate group it belongs to, then the
 * house default. Reading it top to bottom is reading the fallback chain backwards, which is
 * how somebody asked "why was this R340" works it out.
 */
export default function AdminRates() {
  const router = useRouter();
  const me = useMe();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const role = me.data?.user.platformRole;
  useEffect(() => {
    // The engine refuses these endpoints to anyone else anyway; this is so finance sees the
    // console it does have rather than a page of 403s.
    if (me.data && role !== "super_admin") router.replace("/admin");
  }, [me.data, role, router]);

  const cards = useQuery({
    queryKey: ["admin", "rates", "cards"],
    queryFn: () => api<RateCard[]>("/v1/admin/rates/cards"),
    enabled: role === "super_admin",
  });
  const groups = useQuery({
    queryKey: ["admin", "rates", "groups"],
    queryFn: () => api<RateGroup[]>("/v1/admin/rates/groups"),
    enabled: role === "super_admin",
  });
  const accountCards = useQuery({
    queryKey: ["admin", "rates", "accounts"],
    queryFn: () => api<AccountRateAssignment[]>("/v1/admin/rates/accounts"),
    enabled: role === "super_admin",
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "rates"] });
  /**
   * The engine's refusal, said in the words on the form.
   *
   * A validation failure arrives as a list of Zod issues keyed by the field name in the
   * contract, and pasting that into the page tells somebody that `roadFactorBps` must be at
   * least 10000 -- two things they cannot see on screen, in units they never typed.
   */
  const onError = (e: unknown) => {
    if (!(e instanceof ApiRequestError)) return setError(String(e));
    const issues = Array.isArray(e.error.details) ? e.error.details : [];
    const said = issues
      .map((i) => describeRateIssue(i as { path?: unknown[]; message?: string }))
      .filter((s): s is string => s !== null);
    setError(said.length > 0 ? said.join(" ") : e.message);
  };
  const onSaved = () => {
    setError(null);
    invalidate();
  };

  if (role !== "super_admin") return null;

  const defaultCard = cards.data?.find((c) => c.isDefault) ?? null;
  const failed = cards.error ?? groups.error ?? accountCards.error;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Rates"
        lede="What the business charges. A booking is priced on the card written for that account, else on its rate group's live card, else on the house default — and nothing here moves money by itself."
      />

      {error && <Notice tone="error">{error}</Notice>}
      {failed && !error && (
        <Notice tone="error">
          Could not load rates: {failed instanceof Error ? failed.message : String(failed)}
        </Notice>
      )}

      <HouseRates
        cards={cards.data ?? []}
        defaultCard={defaultCard}
        onSaved={onSaved}
        onError={onError}
      />

      <RateGroups
        groups={groups.data ?? []}
        defaultCard={defaultCard}
        onSaved={onSaved}
        onError={onError}
      />

      <AccountRates
        assignments={accountCards.data ?? []}
        defaultCard={defaultCard}
        onSaved={onSaved}
        onError={onError}
      />
    </div>
  );
}

/** The current rate setup: the house cards, one of which is the default everything falls back to. */
function HouseRates({
  cards,
  defaultCard,
  onSaved,
  onError,
}: {
  cards: RateCard[];
  defaultCard: RateCard | null;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <Panel
      title="House rates"
      description="The cards every account is on unless a group or its own card says otherwise."
      actions={
        <button onClick={() => setCreating((v) => !v)} className="btn btn-secondary btn-sm">
          {creating ? "Cancel" : "New card"}
        </button>
      }
      footer={PRICE_FORMULA}
    >
      {creating && (
        <NewHouseCard
          defaultCard={defaultCard}
          onDone={() => {
            setCreating(false);
            onSaved();
          }}
          onError={onError}
        />
      )}
      {cards.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted sm:px-6">
          No house rate card. The engine cannot price anything until there is a default one.
        </div>
      ) : (
        <div className="divide-y divide-line">
          {cards.map((c) => (
            <HouseCardForm key={c.id} card={c} onSaved={onSaved} onError={onError} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function NewHouseCard({
  defaultCard,
  onDone,
  onError,
}: {
  defaultCard: RateCard | null;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [form, setForm] = useState<LeverForm>(leverForm(defaultCard));
  const save = useMutation({
    mutationFn: () =>
      api<RateCard>("/v1/admin/rates/cards", {
        method: "POST",
        json: { name: name.trim(), isDefault: false, active: true, ...leversToPayload(form) },
      }),
    onSuccess: onDone,
    onError,
  });

  return (
    <div className="border-b border-line bg-[#FBFAF8] px-5 py-4 sm:px-6">
      <div className="max-w-md">
        <Field label="Card name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Standard 2027"
            className="input"
            autoFocus
          />
        </Field>
      </div>
      <div className="mt-4">
        <RateLevers form={form} onChange={setForm} />
      </div>
      <p className="mt-3 text-xs text-muted">
        Starts from the default card&apos;s numbers and prices nobody until you make it the default
        or put an account on it.
      </p>
      <button
        onClick={() => save.mutate()}
        disabled={save.isPending || name.trim().length < 2}
        className="btn btn-primary btn-sm mt-3"
      >
        Create card
      </button>
    </div>
  );
}

function HouseCardForm({
  card,
  onSaved,
  onError,
}: {
  card: RateCard;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [form, setForm] = useState<LeverForm>(leverForm(card));
  const [name, setName] = useState(card.name);
  const [isDefault, setIsDefault] = useState(card.isDefault);
  const [active, setActive] = useState(card.active);
  useEffect(() => {
    setForm(leverForm(card));
    setName(card.name);
    setIsDefault(card.isDefault);
    setActive(card.active);
  }, [card]);

  const save = useMutation({
    mutationFn: () =>
      api<RateCard>(`/v1/admin/rates/cards/${card.id}`, {
        method: "PUT",
        json: { name: name.trim(), isDefault, active, ...leversToPayload(form) },
      }),
    onSuccess: onSaved,
    onError,
  });

  return (
    <div className="px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-base font-bold text-ink">
          {card.name} {card.isDefault && <Chip tone="info">default</Chip>}{" "}
          {!card.active && <Chip tone="neutral">retired</Chip>}
        </h3>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="btn btn-primary btn-sm"
        >
          Save
        </button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Card name">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </Field>
        <div className="flex items-end">
          <Toggle
            label="The default card"
            hint="What everything falls back to. Only one card can be it."
            checked={isDefault}
            onChange={setIsDefault}
            disabled={card.isDefault}
          />
        </div>
        <div className="flex items-end">
          <Toggle
            label="Active"
            hint="A retired card prices nothing."
            checked={active}
            onChange={setActive}
            disabled={card.isDefault}
          />
        </div>
      </div>
      <div className="mt-4">
        <RateLevers form={form} onChange={setForm} />
      </div>
    </div>
  );
}
