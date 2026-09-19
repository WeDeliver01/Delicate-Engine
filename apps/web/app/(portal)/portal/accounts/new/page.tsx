"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { AccountMembership, AccountType } from "@delicate/contracts";
import { useMe } from "@/components/use-me";
import { api, ApiRequestError } from "@/lib/api";

/**
 * Onboarding: create a personal account, a new business (organization + first account), or
 * another account inside an organization the user already owns.
 */
export default function NewAccountPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const [type, setType] = useState<AccountType>("business");
  const [name, setName] = useState("");
  const [orgMode, setOrgMode] = useState<"new" | "existing">("new");
  const [orgId, setOrgId] = useState("");
  const [orgName, setOrgName] = useState("");
  const [vat, setVat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ownedOrgs = uniqueOrgs(me.data?.accounts ?? []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const organization =
        type === "business"
          ? orgMode === "existing" && orgId
            ? { id: orgId }
            : { name: orgName, vatNumber: vat || undefined }
          : undefined;
      const created = await api<AccountMembership>("/v1/accounts", {
        method: "POST",
        account: null,
        json: { name, type, organization },
      });
      await qc.invalidateQueries({ queryKey: ["me"] });
      me.switchAccount(created.id);
      router.replace("/portal");
    } catch (err) {
      setError(err instanceof ApiRequestError ? `${err.message} (${err.code})` : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto max-w-lg space-y-6 rounded-lg border border-slate-200 bg-white p-8"
    >
      <h1 className="text-xl font-semibold">Create an account</h1>

      <fieldset className="flex gap-4 text-sm">
        {(["business", "individual"] as const).map((t) => (
          <label key={t} className="flex items-center gap-2">
            <input type="radio" checked={type === t} onChange={() => setType(t)} />
            <span className="capitalize">{t}</span>
          </label>
        ))}
      </fieldset>

      <label className="block text-sm">
        <span className="font-medium">Account name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={type === "business" ? "e.g. Honey Bee – Menlyn" : "Your name"}
          className="mt-1 w-full rounded-md border border-slate-300 p-2"
          required
          minLength={2}
        />
      </label>

      {type === "business" && (
        <div className="space-y-3 rounded-md bg-slate-50 p-4 text-sm">
          {ownedOrgs.length > 0 && (
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={orgMode === "existing"}
                  onChange={() => setOrgMode("existing")}
                />
                Existing business
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={orgMode === "new"}
                  onChange={() => setOrgMode("new")}
                />
                New business
              </label>
            </div>
          )}
          {orgMode === "existing" && ownedOrgs.length > 0 ? (
            <select
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="w-full rounded-md border border-slate-300 p-2"
              required
            >
              <option value="">Select…</option>
              {ownedOrgs.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <>
              <label className="block">
                <span className="font-medium">Business name</span>
                <input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2"
                  required
                  minLength={2}
                />
              </label>
              <label className="block">
                <span className="font-medium">VAT number (optional)</span>
                <input
                  value={vat}
                  onChange={(e) => setVat(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2"
                />
              </label>
            </>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        disabled={busy}
        className="w-full rounded-md bg-slate-900 py-2 font-medium text-white disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}

function uniqueOrgs(accounts: AccountMembership[]): string[] {
  return [
    ...new Set(
      accounts
        .filter((a) => a.role === "customer_owner" && a.organizationId)
        .map((a) => a.organizationId as string),
    ),
  ];
}
