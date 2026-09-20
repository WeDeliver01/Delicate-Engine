"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Booking, WalletSummary } from "@delicate/contracts";
import { useMe } from "@/components/use-me";
import { api } from "@/lib/api";
import { rands } from "@/lib/money";
import { StatusBadge } from "@/components/booking/status-badge";

export default function PortalHome() {
  const me = useMe();
  const account = me.activeAccount;
  const wallet = useQuery({
    queryKey: ["account", account?.id, "wallet"],
    queryFn: () => api<WalletSummary>("/v1/account/wallet"),
    enabled: !!account,
  });
  const bookings = useQuery({
    queryKey: ["account", account?.id, "bookings"],
    queryFn: () => api<{ items: Booking[] }>("/v1/account/bookings?limit=8"),
    enabled: !!account,
  });

  if (!me.data) return null;
  if (!account) {
    return (
      <section className="rounded-xl border border-[#ECEAE6] bg-white p-8">
        <h1 className="text-xl font-semibold">
          Welcome, {me.data.user.fullName ?? me.data.user.email}
        </h1>
        <p className="mt-2 text-[#6B6661]">
          You don&apos;t have an account yet. Create one to start booking deliveries.
        </p>
        <Link
          href="/portal/accounts/new"
          className="mt-6 inline-block rounded-xl bg-[#0A0A0A] px-4 py-2 font-medium text-white hover:bg-[#E84A8A]"
        >
          Create an account
        </Link>
      </section>
    );
  }

  const recent = bookings.data?.items.filter((b) => !b.status.startsWith("rejected")) ?? [];
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section className="rounded-xl border border-[#ECEAE6] bg-white p-6 md:col-span-2">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{account.name}</h1>
            <p className="text-sm text-[#6B6661]">
              {account.type === "business" ? "Business" : "Personal"} ·{" "}
              {wallet.data?.billingMode ?? account.billingMode} · you are{" "}
              {account.role === "customer_owner" ? "an owner" : "staff"}
            </p>
          </div>
          <Link
            href="/portal/book"
            className="rounded-full bg-[#0A0A0A] px-5 py-2 text-sm font-medium text-white hover:bg-[#E84A8A]"
          >
            Book a delivery
          </Link>
        </div>
        <h2 className="mt-8 font-semibold">Recent bookings</h2>
        <ul className="mt-2 divide-y divide-[#F0EDE9] text-sm">
          {recent.map((b) => (
            <li key={b.id}>
              <Link
                href={`/portal/bookings/${b.id}`}
                className="flex items-center justify-between gap-3 py-2 hover:bg-[#FAFAF9]"
              >
                <span className="font-mono">{b.reference}</span>
                <span className="text-[#6B6661]">
                  {b.shipments.length} drop{b.shipments.length === 1 ? "" : "s"}
                  {b.slotDate && ` · ${b.slotDate}`}
                </span>
                <span className="font-mono">{rands(b.totalCents)}</span>
                <StatusBadge status={b.status} />
              </Link>
            </li>
          ))}
          {recent.length === 0 && (
            <li className="py-6 text-center text-[#86817A]">
              No bookings yet — your first one is a click away.
            </li>
          )}
        </ul>
        {recent.length > 0 && (
          <Link
            href="/portal/bookings"
            className="mt-3 inline-block text-sm text-[#86817A] hover:underline"
          >
            All bookings →
          </Link>
        )}
      </section>

      <div className="space-y-6">
        <section className="rounded-xl border border-[#ECEAE6] bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Wallet</h2>
            <Link href="/portal/wallet" className="text-sm text-[#86817A] hover:underline">
              Top up
            </Link>
          </div>
          <p className="mt-3 font-mono text-3xl font-bold">
            {wallet.data ? rands(wallet.data.availableCents) : "…"}
          </p>
          <p className="text-xs text-[#86817A]">
            available · {wallet.data ? rands(wallet.data.heldCents) : "…"} reserved
          </p>
        </section>
        <section className="rounded-xl border border-[#ECEAE6] bg-white p-6 text-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Team</h2>
            {account.role === "customer_owner" && (
              <Link href="/portal/members" className="text-[#86817A] hover:underline">
                Manage
              </Link>
            )}
          </div>
          <p className="mt-2 text-[#6B6661]">
            Owners and staff of this account can book against the shared wallet.
          </p>
        </section>
      </div>
    </div>
  );
}
