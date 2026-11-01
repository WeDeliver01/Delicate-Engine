"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MembershipPlan } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";

/**
 * Edit a membership plan.
 *
 * The warning this form carries is the reason it is not a plain set of inputs. Price and
 * discount are copied onto a membership when somebody joins, so changing them here only ever
 * affects the next person to sign up. The benefit switches are not copied -- they are read
 * from the plan on every quote -- so turning one off changes what existing members pay on
 * their next booking, today. Somebody editing Enterprise at half past five should not have to
 * know that from the source.
 */
const BENEFITS = [
  ["waivesAllSurcharges", "No surcharges at all"],
  ["waivesHolidaySurcharge", "Public holiday delivery included"],
  ["includesApiAccess", "API access"],
  ["prioritySupport", "Priority support"],
  ["dedicatedManager", "Dedicated account manager"],
] as const;

type Draft = Omit<MembershipPlan, "id">;

const blank: Draft = {
  code: "",
  name: "",
  priceCents: 0,
  discountBps: 0,
  suitedFromDeliveries: 0,
  freeShipmentsPerPeriod: 0,
  waivesHolidaySurcharge: false,
  waivesAllSurcharges: false,
  includesApiAccess: false,
  prioritySupport: false,
  dedicatedManager: false,
  sortOrder: 0,
  active: true,
};

export function PlanEditor({
  plan,
  onClose,
}: {
  plan: MembershipPlan | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(plan ? { ...plan } : blank);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  // Asked for, not assumed: "15% off" reads differently once you know it is nine customers.
  const members = useQuery({
    queryKey: ["admin", "membership", "plans", plan?.id, "members"],
    queryFn: () => api<{ count: number }>(`/v1/admin/membership/plans/${plan!.id}/members`),
    enabled: Boolean(plan),
  });

  const save = useMutation({
    mutationFn: () =>
      api(plan ? `/v1/admin/membership/plans/${plan.id}` : "/v1/admin/membership/plans", {
        method: plan ? "PUT" : "POST",
        json: draft,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "membership"] });
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e)),
  });

  const benefitsChanged = plan !== null && BENEFITS.some(([k]) => draft[k] !== plan[k]);
  const priceChanged =
    plan !== null &&
    (draft.priceCents !== plan.priceCents || draft.discountBps !== plan.discountBps);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
        className="panel w-full max-w-2xl p-6"
      >
        <div className="flex items-start justify-between">
          <h2 className="section-title">{plan ? `Edit ${plan.name}` : "New plan"}</h2>
          <button type="button" onClick={onClose} className="link-quiet text-xs">
            Close
          </button>
        </div>
        {plan && members.data && (
          <p className="mt-1 text-xs text-muted">
            {members.data.count === 0
              ? "Nobody is on this plan yet."
              : `${members.data.count} account${members.data.count === 1 ? " is" : "s are"} on this plan.`}
          </p>
        )}

        {error && <p className="alert-error mt-3">{error}</p>}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              required
              minLength={2}
              className="input w-full px-2 py-1"
            />
          </Field>
          <Field
            label="Code"
            hint={plan ? "Cannot change: memberships are keyed on it" : "Lowercase, no spaces"}
          >
            <input
              value={draft.code}
              onChange={(e) => set("code", e.target.value)}
              required
              disabled={plan !== null}
              pattern="[a-z0-9_-]+"
              className="input w-full px-2 py-1 font-mono disabled:opacity-60"
            />
          </Field>

          <Field label="Price a month (rands)">
            <input
              type="number"
              min={0}
              step="0.01"
              value={draft.priceCents / 100}
              onChange={(e) => set("priceCents", Math.round(Number(e.target.value) * 100))}
              required
              className="input w-full px-2 py-1"
            />
          </Field>
          <Field label="Discount (%)">
            <input
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={draft.discountBps / 100}
              onChange={(e) => set("discountBps", Math.round(Number(e.target.value) * 100))}
              required
              className="input w-full px-2 py-1"
            />
          </Field>

          <Field label="Free shipments a month">
            <input
              type="number"
              min={0}
              value={draft.freeShipmentsPerPeriod}
              onChange={(e) => set("freeShipmentsPerPeriod", Number(e.target.value))}
              className="input w-full px-2 py-1"
            />
          </Field>
          <Field label="Worth it from (deliveries a month)" hint="0 hides the line">
            <input
              type="number"
              min={0}
              value={draft.suitedFromDeliveries}
              onChange={(e) => set("suitedFromDeliveries", Number(e.target.value))}
              className="input w-full px-2 py-1"
            />
          </Field>
        </div>

        <fieldset className="mt-4">
          <legend className="label-mini">Benefits</legend>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {BENEFITS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(e) => set(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => set("active", e.target.checked)}
            />
            On sale
          </label>
          <label className="flex items-center gap-2 text-sm">
            Order
            <input
              type="number"
              value={draft.sortOrder}
              onChange={(e) => set("sortOrder", Number(e.target.value))}
              className="input w-20 px-2 py-1"
            />
          </label>
        </div>

        {/* The asymmetry, said out loud at the moment it matters rather than in the source. */}
        {priceChanged && (
          <p className="mt-4 rounded-xl bg-[#FAFAF9] p-3 text-xs text-[#6B6661]">
            The new price and discount apply to whoever joins next. Everyone already on {plan?.name}{" "}
            keeps what they agreed to when they signed up.
          </p>
        )}
        {benefitsChanged && (
          <p className="alert-error mt-3 text-xs">
            Benefits are not locked in the way the price is: this change applies to the{" "}
            {members.data?.count ?? "existing"} member
            {members.data?.count === 1 ? "" : "s"} on {plan?.name} from their next booking.
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={save.isPending} className="btn btn-primary">
            {save.isPending ? "Saving…" : plan ? "Save changes" : "Create plan"}
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label-mini">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}
