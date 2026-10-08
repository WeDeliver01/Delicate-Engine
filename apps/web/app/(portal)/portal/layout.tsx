"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/components/use-me";
import { signOut } from "@/lib/session";
import { AppShell, IdentityFooter, type NavSection } from "@/components/shell/app-shell";

/**
 * Grouped by what the customer came to do, not by which module owns the page. "Book" is first
 * and alone because it is why most people open this at all.
 */
const NAV: NavSection[] = [
  {
    group: "Deliveries",
    items: [
      { href: "/portal", label: "Dashboard", icon: "space_dashboard", exact: true },
      { href: "/portal/book", label: "Book a delivery", icon: "add_box" },
      /*
        One entry, not two. A booking and a shipment are different objects to the engine --
        one order, N parcels -- but a customer who sent one cake sent one thing, and two menu
        items listing the same row is a distinction we are asking them to care about for our
        benefit. The order is still there, reached from the delivery that belongs to it.
      */
      { href: "/portal/shipments", label: "All deliveries", icon: "local_shipping" },
      { href: "/portal/addresses", label: "Addresses", icon: "book_2" },
    ],
  },
  {
    group: "Money",
    items: [
      { href: "/portal/money", label: "Overview", icon: "payments" },
      { href: "/portal/wallet", label: "Wallet", icon: "account_balance_wallet" },
      { href: "/portal/invoices", label: "Invoices", icon: "description" },
      { href: "/portal/quotes", label: "Quotes", icon: "request_quote" },
      { href: "/portal/rewards", label: "Rewards", icon: "loyalty" },
    ],
  },
  {
    group: "Account",
    items: [
      { href: "/portal/members", label: "Team", icon: "group" },
      { href: "/portal/notifications", label: "Alerts", icon: "notifications" },
    ],
  },
];

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
  const active = me.activeAccount;

  return (
    <AppShell
      home="/portal"
      title="Delicate Courier"
      subtitle={active ? active.name : "Customer portal"}
      nav={NAV}
      aside={
        user.platformRole ? (
          <a href="/admin" className="link-quiet block text-xs">
            Ops console →
          </a>
        ) : null
      }
      footer={
        <IdentityFooter
          name={user.fullName ?? user.email}
          meta={active ? active.name : "No account yet"}
          accounts={accounts}
          activeAccountId={active?.id ?? null}
          onSwitch={(id) => me.switchAccount(id)}
          newAccountHref="/portal/accounts/new"
          actions={[
            { label: "Notification settings", href: "/portal/notifications" },
            {
              label: "Sign out",
              onClick: async () => {
                await signOut();
                router.replace("/");
              },
            },
          ]}
        />
      }
    >
      {children}
    </AppShell>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-[#6B6661]">
      {children}
    </div>
  );
}
