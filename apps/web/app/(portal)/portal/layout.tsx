"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe } from "@/components/use-me";
import { signOut } from "@/lib/session";
import { Wordmark } from "@/components/ui";

const NAV = [
  { href: "/portal/book", label: "Book" },
  { href: "/portal/bookings", label: "Bookings" },
  { href: "/portal/wallet", label: "Wallet" },
  { href: "/portal/addresses", label: "Addresses" },
  { href: "/portal/invoices", label: "Invoices" },
  { href: "/portal/notifications", label: "Alerts" },
];

/**
 * Portal shell. Deliberately the same header as the marketing site — sticky, hairline rule,
 * the wordmark with its three dots — so signing in feels like going further into the same
 * product rather than arriving at a different one.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (me.error?.status === 401) router.replace("/login?next=/portal");
  }, [me.error, router]);

  if (me.isLoading) return <Centered>Loading your account…</Centered>;
  if (me.error) return <Centered>Could not load your profile: {me.error.message}</Centered>;
  if (!me.data) return null;

  const { user, accounts } = me.data;

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-50 border-b border-[#F0EDE9] bg-white shadow-sm">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Wordmark href="/portal" />
            {accounts.length > 0 && (
              <label className="hidden items-center gap-2 text-sm lg:flex">
                <span className="text-muted">Account</span>
                <select
                  value={me.activeAccount?.id ?? ""}
                  onChange={(e) => me.switchAccount(e.target.value)}
                  className="input py-1.5"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <Link href="/portal/accounts/new" className="link-quiet whitespace-nowrap">
                  + new
                </Link>
              </label>
            )}
          </div>

          <nav className="hidden items-center gap-7 text-[14px] md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={
                  pathname?.startsWith(n.href)
                    ? "font-medium text-ink"
                    : "text-[#6B6661] transition-colors hover:text-ink"
                }
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-4 text-[13.5px] md:flex">
            {user.platformRole && (
              <Link href="/admin" className="btn btn-secondary btn-sm">
                Ops console
              </Link>
            )}
            <span className="max-w-40 truncate text-[#6B6661]">{user.fullName ?? user.email}</span>
            <button
              onClick={async () => {
                await signOut();
                router.replace("/");
              }}
              className="link-quiet"
            >
              Sign out
            </button>
          </div>

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
            className="flex flex-col gap-[5px] p-2 md:hidden"
          >
            <span className="h-[2px] w-5 bg-ink" />
            <span className="h-[2px] w-5 bg-ink" />
            <span className="h-[2px] w-5 bg-ink" />
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-[#F0EDE9] bg-white md:hidden">
            <nav className="container-page flex flex-col gap-1 py-3 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-2 py-2 text-[#6B6661] hover:bg-[#FAFAF9] hover:text-ink"
                >
                  {n.label}
                </Link>
              ))}
              {accounts.length > 0 && (
                <select
                  value={me.activeAccount?.id ?? ""}
                  onChange={(e) => me.switchAccount(e.target.value)}
                  className="input mt-2"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={async () => {
                  await signOut();
                  router.replace("/");
                }}
                className="link-quiet mt-2 px-2 py-2 text-left"
              >
                Sign out
              </button>
            </nav>
          </div>
        )}
      </header>

      <main className="bg-[#FAFAF9]">
        <div className="container-page py-8 sm:py-10">{children}</div>
      </main>
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
