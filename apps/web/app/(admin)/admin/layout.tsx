"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/components/use-me";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/shipments", label: "Shipments" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/capacity", label: "Capacity" },
  { href: "/admin/drivers", label: "Drivers" },
  { href: "/admin/top-ups", label: "Top-ups" },
  { href: "/admin/accounts", label: "Accounts" },
  { href: "/admin/catalog", label: "Pricing" },
  { href: "/admin/treasury", label: "Treasury" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/ledger", label: "Ledger" },
  { href: "/admin/notifications", label: "Notifications" },
  { href: "/admin/outbox", label: "Outbox" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/settings", label: "Settings" },
];

/** Ops / finance console shell. Staff platform roles only; customers are bounced to the portal. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const me = useMe();

  useEffect(() => {
    if (me.error?.status === 401) router.replace("/login?next=/admin");
    if (me.data && !me.data.user.platformRole) router.replace("/portal");
  }, [me.error, me.data, router]);

  if (!me.data?.user.platformRole) return null;

  return (
    <div className="flex min-h-screen bg-[#F8F6F3]">
      <aside className="w-56 border-r border-[#ECEAE6] bg-white p-4">
        <div className="font-semibold">Ops console</div>
        <div className="text-xs text-[#86817A]">{me.data.user.platformRole.replace("_", " ")}</div>
        <nav className="mt-6 space-y-1 text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="block rounded px-2 py-1 hover:bg-[#F8F6F3]">
              {n.label}
            </Link>
          ))}
        </nav>
        <Link href="/portal" className="mt-8 block text-xs text-[#86817A] hover:underline">
          ← Customer portal
        </Link>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
