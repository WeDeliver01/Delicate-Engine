"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { WALK_IN_ACCOUNT_ID } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { useMe } from "@/components/use-me";
import { setActiveAccountId } from "@/lib/session";
import { rands } from "@/lib/money";
import { Chip, Empty, Notice, PageHeader, Panel } from "@/components/ui";

interface AccountRow {
  id: string;
  name: string;
  type: string;
  billingMode: string;
  status: string;
  organizationName: string | null;
  balanceCents: number | null;
  creditLimitCents: number | null;
}

/**
 * Booking from the console: pick whose account it goes on, then fill in the ordinary form.
 *
 * Deliberately not a second booking form. The portal's is eight hundred lines of pricing,
 * slots, addresses and parcels, and a console copy of it would be a console copy of all the
 * bugs too, drifting apart one fix at a time. So this page answers the only question the
 * portal's form cannot — whose wallet pays — and then hands over to it, with the acting-as
 * banner across the top saying whose account you are in.
 */
export default function AdminBook() {
  const me = useMe();
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim(), 250);
  const [error, setError] = useState<string | null>(null);

  const accounts = useQuery({
    queryKey: ["admin", "accounts", "picker", term],
    queryFn: () =>
      api<{ items: AccountRow[] }>(
        `/v1/admin/accounts?limit=20${term ? `&q=${encodeURIComponent(term)}` : ""}`,
      ),
  });

  /*
    The walk-in account is created by migration, so it is here on every environment that is up
    to date -- and conspicuously absent on one that is not. Ask for it before stepping into it:
    a clear sentence beats dropping somebody into a portal that 403s every request.
  */
  const walkIn = useMutation({
    mutationFn: () => api<{ id: string }>("/v1/account", { account: WALK_IN_ACCOUNT_ID }),
    onSuccess: () => go(WALK_IN_ACCOUNT_ID),
    onError: (e) =>
      setError(
        // The guard's own words for an id that resolves to nothing, which here means the
        // migration has not run rather than that anyone did anything wrong.
        e instanceof ApiRequestError && /unknown account/i.test(e.message)
          ? "The walk-in account is not in this database yet. It arrives with the migrations — deploy, then try again."
          : `Could not open the walk-in account: ${e instanceof Error ? e.message : String(e)}`,
      ),
  });

  /** Step into the account and go straight at the booking form. */
  function go(id: string) {
    setActiveAccountId(id);
    // A full load, not a client navigation: everything cached on this page was fetched as the
    // console, and the portal has to come up as the account.
    window.location.assign("/portal/book");
  }

  if (me.data && me.data.user.platformRole !== "super_admin") {
    return (
      <Empty>
        Booking on a customer&apos;s behalf is a super admin capability, because it spends their
        money. Ask one of them, or take the booking in the customer&apos;s own portal.
      </Empty>
    );
  }

  const rows = accounts.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Book a delivery"
        lede="Choose whose account the delivery is charged to. The booking form opens inside that account, and every step is recorded against your name."
      />

      {error && <Notice tone="error">{error}</Notice>}

      <Panel title="Book for a customer" description="Search by account or organisation name.">
        <div className="px-5 py-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Account or organisation…"
            autoFocus
            className="input w-full"
          />
        </div>
        {accounts.error ? (
          <p className="px-5 pb-4 text-sm text-[#C13B73]">
            Could not load accounts: {String(accounts.error)}
          </p>
        ) : rows.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">
            {accounts.isLoading
              ? "Loading…"
              : term
                ? `No account matches “${term}”. Check the spelling, or book it as a walk-in below.`
                : "No accounts yet."}
          </p>
        ) : (
          <ul className="divide-y divide-[#F0EDE9] border-t border-line">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{a.name}</p>
                  <p className="truncate text-xs text-muted">
                    {a.organizationName ?? (a.type === "individual" ? "Individual" : "Business")}
                  </p>
                </div>
                <div className="text-right">
                  {/* What ops needs to know before spending it: the money, and whether the
                      account is in a state that can be booked on at all. */}
                  <span
                    className={`figure text-sm ${(a.balanceCents ?? 0) < 0 ? "text-[#C13B73]" : ""}`}
                  >
                    {rands(a.balanceCents ?? 0)}
                  </span>
                  {(a.creditLimitCents ?? 0) > 0 && (
                    <span className="block text-xs text-muted">
                      on {rands(a.creditLimitCents ?? 0)} credit
                    </span>
                  )}
                </div>
                {a.status !== "active" && <Chip tone="bad">{a.status}</Chip>}
                <button
                  type="button"
                  disabled={a.status !== "active"}
                  onClick={() => go(a.id)}
                  className="btn btn-primary btn-sm disabled:opacity-40"
                  title={
                    a.status === "active"
                      ? "Open the booking form charged to this account"
                      : "This account is not active, so nothing can be booked on it"
                  }
                >
                  Book for this account
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Walk-in or phoned in"
        description="Somebody with no account, who needs it collected today."
      >
        <div className="space-y-3 px-5 py-4 text-sm text-muted">
          <p>
            The booking goes on the house <strong className="text-ink">Walk-in (ad hoc)</strong>{" "}
            account rather than a new one-use account nobody will ever close again. Put the
            caller&apos;s name and number in the booking&apos;s customer reference — that is what
            makes the delivery findable afterwards.
          </p>
          <p>
            It is a postpaid account, so the booking goes through on credit and the balance sits
            negative until the cash or card is recorded as a top-up against it.
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              walkIn.mutate();
            }}
            disabled={walkIn.isPending}
            className="btn btn-secondary btn-sm"
          >
            {walkIn.isPending ? "Opening…" : "Book as a walk-in"}
          </button>
        </div>
      </Panel>
    </div>
  );
}

/** Waits for the typing to stop, so a four-letter name is one query and not four. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
