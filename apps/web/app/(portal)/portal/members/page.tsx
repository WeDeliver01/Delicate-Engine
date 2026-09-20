"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountRole, Member } from "@delicate/contracts";
import { useMe } from "@/components/use-me";
import { api, ApiRequestError } from "@/lib/api";

export default function MembersPage() {
  const me = useMe();
  const qc = useQueryClient();
  const account = me.activeAccount;
  const key = ["account", account?.id, "members"];
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccountRole>("customer_staff");
  const [error, setError] = useState<string | null>(null);

  const members = useQuery({
    queryKey: key,
    queryFn: () => api<Member[]>("/v1/account/members"),
    enabled: !!account,
  });

  const add = useMutation({
    mutationFn: () => api<Member>("/v1/account/members", { method: "POST", json: { email, role } }),
    onSuccess: () => {
      setEmail("");
      setError(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? describe(err) : String(err)),
  });

  const remove = useMutation({
    mutationFn: (userId: string) =>
      api<void>(`/v1/account/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (err) => setError(err instanceof ApiRequestError ? describe(err) : String(err)),
  });

  if (!account) return null;
  const isOwner = account.role === "customer_owner";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="rounded-lg border border-[#ECEAE6] bg-white p-6">
        <h1 className="text-xl font-semibold">Members of {account.name}</h1>
        <ul className="mt-4 divide-y divide-[#F0EDE9] text-sm">
          {members.data?.map((m) => (
            <li key={m.userId} className="flex items-center justify-between py-2">
              <div>
                <div>{m.fullName ?? m.email}</div>
                <div className="text-[#86817A]">{m.email}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[#86817A]">
                  {m.role === "customer_owner" ? "Owner" : "Staff"}
                </span>
                {isOwner && (
                  <button
                    onClick={() => remove.mutate(m.userId)}
                    className="text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {isOwner && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
          className="rounded-lg border border-[#ECEAE6] bg-white p-6 text-sm"
        >
          <h2 className="font-semibold">Add a member</h2>
          <p className="mt-1 text-[#86817A]">
            They need to have signed in to the portal at least once.
          </p>
          <div className="mt-4 flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@company.co.za"
              className="flex-1 rounded-xl border border-[#DAD6CF] p-2"
              required
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AccountRole)}
              className="rounded-xl border border-[#DAD6CF] p-2"
            >
              <option value="customer_staff">Staff</option>
              <option value="customer_owner">Owner</option>
            </select>
            <button
              disabled={add.isPending}
              className="rounded-xl bg-[#0A0A0A] px-4 text-white disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {error && <p className="mt-3 text-red-600">{error}</p>}
        </form>
      )}
    </div>
  );
}

function describe(err: ApiRequestError): string {
  const hint = (err.error.details as { hint?: string } | undefined)?.hint;
  return hint ? `${err.message} — ${hint}` : err.message;
}
