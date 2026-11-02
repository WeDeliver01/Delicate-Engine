"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useDebounced } from "@/components/shipments/filter-bar";

export interface PickableAccount {
  id: string;
  name: string;
  code: string;
  organizationName: string | null;
}

/**
 * Find a customer by name, code or organisation.
 *
 * Search rather than a dropdown: the account list is as long as the customer book and the
 * person using this knows the name or the code — which is what they have written on a box —
 * not where it falls alphabetically.
 */
export function AccountPicker({
  placeholder = "Account, code or organisation…",
  exclude = [],
  onPick,
}: {
  placeholder?: string;
  /** Already in the group, or already on their own card: shown as such rather than hidden. */
  exclude?: string[];
  onPick: (account: PickableAccount) => void;
}) {
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim(), 250);
  const accounts = useQuery({
    queryKey: ["admin", "accounts", "picker", term],
    queryFn: () =>
      api<{ items: PickableAccount[] }>(
        `/v1/admin/accounts?limit=10${term ? `&q=${encodeURIComponent(term)}` : ""}`,
      ),
    enabled: term.length > 0,
  });

  const rows = accounts.data?.items ?? [];

  return (
    <div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder}
        className="input w-full"
      />
      {term.length > 0 && (
        <div className="mt-2 divide-y divide-line rounded-xl border border-line">
          {rows.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">
              {accounts.isLoading ? "Searching…" : `Nothing matches “${term}”.`}
            </p>
          ) : (
            rows.map((a) => {
              const already = exclude.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={already}
                  onClick={() => {
                    onPick(a);
                    setSearch("");
                  }}
                  className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[#FAF7F3] disabled:opacity-40"
                >
                  <span>
                    {a.name}
                    {a.organizationName && (
                      <span className="text-muted"> · {a.organizationName}</span>
                    )}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {already ? "already in" : a.code}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
