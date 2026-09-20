"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/components/use-me";
import { signOut } from "@/lib/session";

/**
 * Portal shell: requires a signed-in user, shows the account switcher, and routes users with
 * no account yet to onboarding. Everything under /portal renders inside this frame.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const me = useMe();

  useEffect(() => {
    if (me.error?.status === 401) router.replace("/login?next=/portal");
  }, [me.error, router]);

  if (me.isLoading) return <Centered>Loading your account…</Centered>;
  if (me.error) return <Centered>Could not load your profile: {me.error.message}</Centered>;
  if (!me.data) return null;

  const { user, accounts } = me.data;

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      <header className="border-b border-[#ECEAE6] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/portal" className="flex items-center gap-2.5">
              <span className="text-[17px] font-bold tracking-tight text-[#0A0A0A]">
                Delicate Courier
              </span>
              <span className="flex gap-1">
                <span className="w-[7px] h-[7px] rounded-full bg-[#E84A8A]" />
                <span className="w-[7px] h-[7px] rounded-full bg-[#F4C430]" />
                <span className="w-[7px] h-[7px] rounded-full bg-[#7C5CFF]" />
              </span>
            </Link>
            {accounts.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <span className="text-[#86817A]">Account</span>
                <select
                  value={me.activeAccount?.id ?? ""}
                  onChange={(e) => me.switchAccount(e.target.value)}
                  className="rounded-xl border border-[#DAD6CF] bg-white px-2 py-1"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <Link href="/portal/accounts/new" className="text-[#86817A] hover:underline">
                  + new
                </Link>
              </label>
            )}
          </div>
          <nav className="hidden items-center gap-6 text-sm md:flex">
            <Link href="/portal/book" className="text-[#6B6661] hover:text-[#0A0A0A]">
              Book
            </Link>
            <Link href="/portal/bookings" className="text-[#6B6661] hover:text-[#0A0A0A]">
              Bookings
            </Link>
            <Link href="/portal/wallet" className="text-[#6B6661] hover:text-[#0A0A0A]">
              Wallet
            </Link>
          </nav>
          <div className="flex items-center gap-4 text-sm">
            {user.platformRole && (
              <Link href="/admin" className="rounded-xl border border-[#DAD6CF] px-3 py-1">
                Ops console
              </Link>
            )}
            <span className="text-[#6B6661]">{user.fullName ?? user.email}</span>
            <button
              onClick={async () => {
                await signOut();
                router.replace("/");
              }}
              className="text-[#86817A] hover:underline"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-[#6B6661]">
      {children}
    </div>
  );
}
