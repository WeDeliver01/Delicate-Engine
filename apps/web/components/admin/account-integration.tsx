"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountIntegrationAccess } from "@delicate/contracts";
import { useState } from "react";
import { api, ApiRequestError } from "@/lib/api";
import { useMe } from "@/components/use-me";
import { CopyField, Notice, Panel, Toggle } from "@/components/ui";

/**
 * How a merchant's own systems reach this account.
 *
 * Two questions get asked about an integrated customer, usually at once and usually while
 * somebody is on the phone: what do we put in their store's settings, and why has it stopped
 * booking. Both are answered here, because the alternative was a super_admin writing a
 * mapping row by hand and a PATCH that replaced every other merchant's grant on its way past.
 */
export function AccountIntegration({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const key = ["admin", "accounts", accountId, "integration"];
  const access = useQuery({
    queryKey: key,
    queryFn: () => api<AccountIntegrationAccess>(`/v1/admin/accounts/${accountId}/integration`),
  });

  const [error, setError] = useState<string | null>(null);
  const grant = useMutation({
    mutationFn: ({ id, granted }: { id: string; granted: boolean }) =>
      api(`/v1/admin/accounts/${accountId}/integration/${id}`, {
        method: "PUT",
        json: { granted },
      }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : String(e)),
  });

  const me = useMe();
  const canWrite = me.data?.user.platformRole === "super_admin";

  if (!access.data) return null;
  const { code, services } = access.data;

  return (
    <Panel title="Integration" description="What this customer's own systems use to book with us.">
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <CopyField
          label="Account reference"
          value={code}
          hint="Paste this into their store's delivery settings. It is the only identifier they need."
        />
        <CopyField
          label="Account ID"
          value={accountId}
          hint="For support and for reading logs. A store never needs it."
        />
      </div>

      <div className="border-t border-line p-5">
        <h3 className="field-label">May book for this account</h3>
        <p className="mt-0.5 text-xs text-muted">
          Standing permission to book against this customer&rsquo;s wallet. Until one of these is
          on, their store gets a refusal however correct its settings are.
        </p>
        <div className="mt-3 space-y-3">
          {services.length === 0 && (
            <p className="text-sm text-muted">No integrations have been issued credentials yet.</p>
          )}
          {services.map((s) => (
            <Toggle
              key={s.id}
              checked={s.granted}
              disabled={!canWrite || grant.isPending || s.status !== "active"}
              onChange={(granted) => grant.mutate({ id: s.id, granted })}
              label={s.name}
              hint={
                s.status === "active"
                  ? s.slug
                  : `${s.slug} — this credential has been revoked, so the switch does nothing`
              }
            />
          ))}
        </div>
        {!canWrite && (
          <p className="mt-3 text-xs text-muted">Only a super admin can change this.</p>
        )}
      </div>

      <Notice tone="error">{error}</Notice>
    </Panel>
  );
}
