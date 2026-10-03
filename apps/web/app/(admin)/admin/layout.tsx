"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMe } from "@/components/use-me";
import { signOut } from "@/lib/session";
import { AppShell, IdentityFooter, type NavSection } from "@/components/shell/app-shell";

/** Grouped so the sidebar reads as the shape of the business, not an alphabetical dump. */
const NAV: NavSection[] = [
  {
    group: "Today",
    items: [
      { href: "/admin", label: "Overview", icon: "space_dashboard", exact: true },
      { href: "/admin/dispatch", label: "Dispatch board", icon: "dashboard" },
      { href: "/admin/shipments", label: "Shipments", icon: "local_shipping" },
      { href: "/admin/bookings", label: "Bookings", icon: "receipt_long" },
      { href: "/admin/changes", label: "Change requests", icon: "edit_note" },
      { href: "/admin/plan", label: "Plan the day", icon: "auto_awesome" },
      { href: "/admin/trips", label: "Trips", icon: "route" },
      { href: "/admin/capacity", label: "Capacity", icon: "event_available" },
      { href: "/admin/drivers", label: "Drivers", icon: "directions_car" },
    ],
  },
  {
    group: "Money",
    items: [
      { href: "/admin/treasury", label: "Treasury", icon: "savings" },
      { href: "/admin/payments", label: "Payments", icon: "payments" },
      { href: "/admin/billing", label: "Billing", icon: "request_quote" },
      { href: "/admin/top-ups", label: "Top-ups", icon: "add_card" },
      { href: "/admin/ledger", label: "Ledger", icon: "account_balance" },
      { href: "/admin/reports", label: "Reports", icon: "monitoring" },
      { href: "/admin/reconciliation", label: "Reconciliation", icon: "rule" },
    ],
  },
  {
    group: "Setup",
    items: [
      { href: "/admin/accounts", label: "Accounts", icon: "apartment" },
      { href: "/admin/catalog", label: "Pricing", icon: "sell" },
      { href: "/admin/notifications", label: "Notifications", icon: "campaign" },
      { href: "/admin/loyalty", label: "Rewards", icon: "loyalty" },
      { href: "/admin/settings", label: "Settings", icon: "settings" },
    ],
  },
  {
    group: "Engine",
    items: [
      { href: "/admin/outbox", label: "Outbox", icon: "outbox" },
      { href: "/admin/audit", label: "Audit log", icon: "history" },
    ],
  },
];

/**
 * Ops console shell. Same wordmark, palette and type as the marketing site and the portal —
 * this is the back of the same shop, not a different building. Staff platform roles only;
 * customers are bounced to the portal.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const me = useMe();

  // The one number worth carrying in the navigation: a customer is waiting on each of these.
  const pending = useQuery({
    queryKey: ["admin", "changes", "pending-count"],
    queryFn: () => api<{ count: number }>("/v1/admin/changes/pending-count"),
    enabled: !!me.data?.user.platformRole,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (me.error?.status === 401) router.replace("/login?next=/admin");
    if (me.data && !me.data.user.platformRole) router.replace("/portal");
  }, [me.error, me.data, router]);

  const user = me.data?.user;
  // Narrowed into a local so the role is non-null below; reading it off `me.data` again would
  // lose the check as far as the compiler is concerned.
  const platformRole = user?.platformRole;
  if (!user || !platformRole) return null;

  return (
    <AppShell
      home="/admin"
      title="Ops console"
      subtitle={`Ops console · ${platformRole.replace(/_/g, " ")}`}
      nav={NAV.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.href === "/admin/changes" ? { ...item, badge: pending.data?.count } : item,
        ),
      }))}
      aside={
        <a href="/portal" className="link-quiet block text-xs">
          ← Customer portal
        </a>
      }
      footer={
        <IdentityFooter
          name={user.fullName ?? user.email}
          meta={platformRole.replace(/_/g, " ")}
          actions={[
            { label: "Settings", href: "/admin/settings" },
            { label: "Audit log", href: "/admin/audit" },
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
