"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AccountRole,
  AccountStatus,
  AccountType,
  AdminAccountDetail,
} from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime } from "@/lib/money";
import { useMe } from "@/components/use-me";

/**
 * One customer's account, as the people who run the business see it: who they are, who they
 * invoice, and who can sign in.
 *
 * Everything here is somebody else's. Staff can read it; only a super admin can change it,
 * and every change keeps what it was before — an invoice sent to the wrong address and a
 * suspended account that should have been open are both the kind of mistake that is only
 * ever found weeks later, by someone asking who did this.
 */
export function AccountDetail({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const me = useMe();
  const canWrite = me.data?.user.platformRole === "super_admin";
  const key = ["admin", "accounts", accountId, "detail"];
  const detail = useQuery({
    queryKey: key,
    queryFn: () => api<AdminAccountDetail>(`/v1/admin/accounts/${accountId}`),
  });
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));
  const invalidate = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ["admin", "accounts", accountId] });
  };

  if (!detail.data) return null;
  const d = detail.data;

  return (
    <div className="space-y-6">
      {error && <p className="alert-error">{error}</p>}
      <Details detail={d} canWrite={canWrite} onSaved={invalidate} onError={onError} />
      {d.organization && (
        <Organisation
          accountId={accountId}
          detail={d}
          canWrite={canWrite}
          onSaved={invalidate}
          onError={onError}
        />
      )}
      <Users
        accountId={accountId}
        detail={d}
        canWrite={canWrite}
        onSaved={invalidate}
        onError={onError}
      />
    </div>
  );
}

function Details({
  detail,
  canWrite,
  onSaved,
  onError,
}: {
  detail: AdminAccountDetail;
  canWrite: boolean;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [f, setF] = useState({
    name: detail.account.name,
    type: detail.account.type as AccountType,
    status: detail.account.status as AccountStatus,
    billingEmail: detail.billingEmail ?? "",
    requiresVehicleClass: detail.requiresVehicleClass ?? "",
  });
  useEffect(() => {
    setF({
      name: detail.account.name,
      type: detail.account.type,
      status: detail.account.status,
      billingEmail: detail.billingEmail ?? "",
      requiresVehicleClass: detail.requiresVehicleClass ?? "",
    });
  }, [detail]);

  const save = useMutation({
    mutationFn: () =>
      api(`/v1/admin/accounts/${detail.account.id}`, {
        method: "PATCH",
        json: {
          name: f.name.trim(),
          type: f.type,
          status: f.status,
          billingEmail: f.billingEmail.trim() || null,
          requiresVehicleClass: f.requiresVehicleClass.trim() || null,
        },
      }),
    onSuccess: onSaved,
    onError,
  });

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">Account details</h2>
        {canWrite && (
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="btn btn-secondary btn-sm"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Text
          label="Account name"
          value={f.name}
          onChange={(v) => setF({ ...f, name: v })}
          disabled={!canWrite}
        />
        <Pick
          label="Type"
          value={f.type}
          options={[
            ["business", "Business"],
            ["individual", "Individual"],
          ]}
          onChange={(v) => setF({ ...f, type: v as AccountType })}
          disabled={!canWrite}
        />
        <Pick
          label="Status"
          value={f.status}
          options={[
            ["active", "Active"],
            ["suspended", "Suspended"],
            ["closed", "Closed"],
          ]}
          onChange={(v) => setF({ ...f, status: v as AccountStatus })}
          disabled={!canWrite}
          hint="Suspended and closed accounts cannot book. Existing deliveries carry on."
        />
        <Text
          label="Billing email"
          value={f.billingEmail}
          onChange={(v) => setF({ ...f, billingEmail: v })}
          disabled={!canWrite}
          hint="Where invoices and every notification for this account are sent."
        />
        <Text
          label="Requires vehicle class"
          value={f.requiresVehicleClass}
          onChange={(v) => setF({ ...f, requiresVehicleClass: v })}
          disabled={!canWrite}
          hint="Their work only goes on a vehicle of this class. Leave empty for any."
        />
        <div className="text-sm">
          <span className="field-label">Opened</span>
          <p className="mt-1.5 text-ink">{dateTime(detail.account.createdAt)}</p>
        </div>
      </div>
    </section>
  );
}

function Organisation({
  accountId,
  detail,
  canWrite,
  onSaved,
  onError,
}: {
  accountId: string;
  detail: AdminAccountDetail;
  canWrite: boolean;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const org = detail.organization!;
  const [f, setF] = useState({
    name: org.name,
    registrationNumber: org.registrationNumber ?? "",
    vatNumber: org.vatNumber ?? "",
  });
  useEffect(() => {
    setF({
      name: org.name,
      registrationNumber: org.registrationNumber ?? "",
      vatNumber: org.vatNumber ?? "",
    });
  }, [org]);

  const save = useMutation({
    mutationFn: () =>
      api(`/v1/admin/accounts/${accountId}/organization`, {
        method: "PATCH",
        json: {
          name: f.name.trim(),
          registrationNumber: f.registrationNumber.trim() || null,
          vatNumber: f.vatNumber.trim() || null,
        },
      }),
    onSuccess: onSaved,
    onError,
  });

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">The business behind it</h2>
        {canWrite && (
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="btn btn-secondary btn-sm"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">
        What appears above the address on their tax invoice. A VAT number here is the
        customer&apos;s, not ours.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Text
          label="Registered name"
          value={f.name}
          onChange={(v) => setF({ ...f, name: v })}
          disabled={!canWrite}
        />
        <Text
          label="Registration number"
          value={f.registrationNumber}
          onChange={(v) => setF({ ...f, registrationNumber: v })}
          disabled={!canWrite}
        />
        <Text
          label="VAT number"
          value={f.vatNumber}
          onChange={(v) => setF({ ...f, vatNumber: v })}
          disabled={!canWrite}
        />
      </div>
    </section>
  );
}

function Users({
  accountId,
  detail,
  canWrite,
  onSaved,
  onError,
}: {
  accountId: string;
  detail: AdminAccountDetail;
  canWrite: boolean;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccountRole>("customer_staff");

  const add = useMutation({
    mutationFn: () =>
      api(`/v1/admin/accounts/${accountId}/members`, {
        method: "POST",
        json: { email: email.trim(), role },
      }),
    onSuccess: () => {
      setEmail("");
      onSaved();
    },
    onError,
  });
  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: AccountRole }) =>
      api(`/v1/admin/accounts/${accountId}/members/${v.userId}`, {
        method: "PATCH",
        json: { role: v.role },
      }),
    onSuccess: onSaved,
    onError,
  });
  const remove = useMutation({
    mutationFn: (userId: string) =>
      api(`/v1/admin/accounts/${accountId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: onSaved,
    onError,
  });

  return (
    <section className="panel p-5">
      <h2 className="section-title">Who can sign in</h2>
      <p className="mt-1 text-xs text-muted">
        An owner can invite and remove people and see the money; staff can book and track.
      </p>
      <ul className="mt-3 divide-y divide-[#F0EDE9] text-sm">
        {detail.members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{m.fullName ?? m.email}</span>
              <span className="block truncate text-xs text-muted">{m.email}</span>
            </span>
            <select
              value={m.role}
              disabled={!canWrite}
              onChange={(e) =>
                changeRole.mutate({ userId: m.userId, role: e.target.value as AccountRole })
              }
              className="input w-40 px-2 py-1 text-xs"
            >
              <option value="customer_owner">Owner</option>
              <option value="customer_staff">Staff</option>
            </select>
            {canWrite && (
              <>
                <Credentials accountId={accountId} userId={m.userId} email={m.email} />
                <button
                  type="button"
                  onClick={() => remove.mutate(m.userId)}
                  className="text-xs text-muted transition-colors hover:text-[#C13B73]"
                >
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
        {detail.members.length === 0 && (
          <li className="py-3 text-sm text-muted">
            Nobody can sign in to this account yet — it is being run from the console.
          </li>
        )}
      </ul>

      {canWrite && (
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="their@email.co.za"
            className="input max-w-xs px-2 py-1 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AccountRole)}
            className="input w-32 px-2 py-1 text-sm"
          >
            <option value="customer_staff">Staff</option>
            <option value="customer_owner">Owner</option>
          </select>
          <button
            type="button"
            disabled={!email.includes("@") || add.isPending}
            onClick={() => add.mutate()}
            className="btn btn-secondary btn-sm"
          >
            Give access
          </button>
          {/* The engine can only attach somebody it already knows: the row is created when
              they first sign in, and a membership for an id that does not exist yet would
              point at nobody. */}
          <span className="w-full text-xs text-muted">
            They must have signed in once before they can be added.
          </span>
        </div>
      )}
    </section>
  );
}

function Text({
  label,
  value,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="field-label">{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="input mt-1"
      />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Pick({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="field-label">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="input mt-1"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/**
 * Somebody's sign-in, for whoever is on the phone to them.
 *
 * A reset link is the normal path and the first thing offered: the customer sets their own
 * password and nobody else ever knows it. Setting one by hand is behind a second click
 * because it means staff can then sign in as that customer and nothing afterwards would look
 * unusual — it is for the case where a customer genuinely cannot receive our email, and it
 * is recorded as having happened.
 */
function Credentials({
  accountId,
  userId,
  email,
}: {
  accountId: string;
  userId: string;
  email: string;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [newEmail, setNewEmail] = useState(email);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/v1/admin/accounts/${accountId}/members/${userId}/credentials`, {
        method: "POST",
        json: body,
      }),
    onSuccess: (_d, body) => {
      setError(null);
      setPassword("");
      setSaid(
        body.action === "send_reset"
          ? "Reset link sent."
          : body.action === "set_password"
            ? "Password set. Tell them, and ask them to change it."
            : body.action === "set_email"
              ? "Address changed."
              : body.blocked
                ? "Sign-in blocked."
                : "Sign-in restored.",
      );
    },
    onError: (e) => {
      setSaid(null);
      setError(e instanceof ApiRequestError ? e.message : String(e));
    },
  });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="link-quiet shrink-0 text-xs">
        Sign-in…
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-line p-3 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-medium text-ink">Sign-in for {email}</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="text-muted hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => act.mutate({ action: "send_reset" })}
          className="btn btn-secondary btn-sm"
        >
          Email them a reset link
        </button>
        <button
          type="button"
          onClick={() => act.mutate({ action: "block_sign_in", blocked: true })}
          className="link-quiet text-xs"
        >
          Block sign-in
        </button>
        <button
          type="button"
          onClick={() => act.mutate({ action: "block_sign_in", blocked: false })}
          className="link-quiet text-xs"
        >
          Restore
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          className="input px-2 py-1"
          placeholder="their@email.co.za"
        />
        <button
          type="button"
          disabled={!newEmail.includes("@") || newEmail === email}
          onClick={() => act.mutate({ action: "set_email", email: newEmail.trim() })}
          className="btn btn-secondary btn-sm disabled:opacity-40"
        >
          Change address
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input px-2 py-1 font-mono"
          placeholder="A new password, at least 10 characters"
        />
        <button
          type="button"
          disabled={password.length < 10}
          onClick={() => act.mutate({ action: "set_password", password })}
          className="btn btn-secondary btn-sm disabled:opacity-40"
        >
          Set password
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        Only when they cannot receive email. You will be able to sign in as them, so it is recorded
        against your name — the password itself is not kept anywhere.
      </p>

      {said && <p className="alert-success mt-3">{said}</p>}
      {error && <p className="alert-error mt-3">{error}</p>}
    </div>
  );
}
