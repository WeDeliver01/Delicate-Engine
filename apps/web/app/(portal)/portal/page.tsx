"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Member } from "@delicate/contracts";
import { useMe } from "@/components/use-me";
import { api } from "@/lib/api";

export default function PortalHome() {
  const me = useMe();
  const account = me.activeAccount;

  const members = useQuery({
    queryKey: ["account", account?.id, "members"],
    queryFn: () => api<Member[]>("/v1/account/members"),
    enabled: !!account,
  });

  if (!me.data) return null;

  if (!account) {
    return (
      <section className="rounded-lg border border-[#ECEAE6] bg-white p-8">
        <h1 className="text-xl font-semibold">
          Welcome, {me.data.user.fullName ?? me.data.user.email}
        </h1>
        <p className="mt-2 text-[#6B6661]">
          You don&apos;t have an account yet. Create one to start booking deliveries.
        </p>
        <Link
          href="/portal/accounts/new"
          className="mt-6 inline-block rounded-xl bg-[#0A0A0A] px-4 py-2 font-medium text-white"
        >
          Create an account
        </Link>
      </section>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section className="rounded-lg border border-[#ECEAE6] bg-white p-6 md:col-span-2">
        <h1 className="text-xl font-semibold">{account.name}</h1>
        <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-[#86817A]">Type</dt>
          <dd className="capitalize">{account.type}</dd>
          <dt className="text-[#86817A]">Billing</dt>
          <dd className="capitalize">{account.billingMode}</dd>
          <dt className="text-[#86817A]">Your role</dt>
          <dd>{account.role === "customer_owner" ? "Owner" : "Staff"}</dd>
          <dt className="text-[#86817A]">Status</dt>
          <dd className="capitalize">{account.status}</dd>
        </dl>
        <div className="mt-6 rounded-xl border border-dashed border-[#DAD6CF] p-4 text-sm text-[#86817A]">
          Wallet, bookings and tracking arrive in Phase 1.
        </div>
      </section>

      <section className="rounded-lg border border-[#ECEAE6] bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Members</h2>
          {account.role === "customer_owner" && (
            <Link href="/portal/members" className="text-sm text-[#86817A] hover:underline">
              Manage
            </Link>
          )}
        </div>
        <ul className="mt-3 space-y-2 text-sm">
          {members.data?.map((m) => (
            <li key={m.userId} className="flex justify-between">
              <span>{m.fullName ?? m.email}</span>
              <span className="text-[#86817A]">
                {m.role === "customer_owner" ? "Owner" : "Staff"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
