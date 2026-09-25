"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe } from "@/components/use-me";
import { BrandDots } from "@/components/ui";

/** Grouped so the sidebar reads as the shape of the business, not an alphabetical dump. */
const NAV: { group: string; items: { href: string; label: string }[] }[] = [
  {
    group: "Today",
    items: [
      { href: "/admin", label: "Overview" },
      { href: "/admin/shipments", label: "Shipments" },
      { href: "/admin/bookings", label: "Bookings" },
      { href: "/admin/capacity", label: "Capacity" },
      { href: "/admin/drivers", label: "Drivers" },
    ],
  },
  {
    group: "Money",
    items: [
      { href: "/admin/treasury", label: "Treasury" },
      { href: "/admin/payments", label: "Payments" },
      { href: "/admin/billing", label: "Billing" },
      { href: "/admin/top-ups", label: "Top-ups" },
      { href: "/admin/ledger", label: "Ledger" },
    ],
  },
  {
    group: "Setup",
    items: [
      { href: "/admin/accounts", label: "Accounts" },
      { href: "/admin/catalog", label: "Pricing" },
      { href: "/admin/notifications", label: "Notifications" },
      { href: "/admin/settings", label: "Settings" },
    ],
  },
  {
    group: "Engine",
    items: [
      { href: "/admin/outbox", label: "Outbox" },
      { href: "/admin/audit", label: "Audit log" },
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
  const pathname = usePathname();
  const me = useMe();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (me.error?.status === 401) router.replace("/login?next=/admin");
    if (me.data && !me.data.user.platformRole) router.replace("/portal");
  }, [me.error, me.data, router]);

  if (!me.data?.user.platformRole) return null;

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : (pathname?.startsWith(href) ?? false);

  const nav = (
    <nav className="space-y-6">
      {NAV.map((section) => (
        <div key={section.group}>
          <p className="label-mini px-2.5">{section.group}</p>
          <ul className="mt-2 space-y-0.5">
            {section.items.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className={`block rounded-xl px-2.5 py-1.5 text-sm transition-colors ${
                    isActive(n.href)
                      ? "bg-[#FCEEF4] font-medium text-[#C13B73]"
                      : "text-[#6B6661] hover:bg-[#FAFAF9] hover:text-ink"
                  }`}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      {/* Mobile bar */}
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-[#F0EDE9] bg-white px-4 py-3 lg:hidden">
        <Link href="/admin" className="flex items-center gap-2.5">
          <span className="font-display text-[15px] font-bold tracking-tight text-ink">
            Ops console
          </span>
          <BrandDots />
        </Link>
        <button
          onClick={() => setOpen(!open)}
          aria-label="Menu"
          className="flex flex-col gap-[5px] p-2"
        >
          <span className="h-[2px] w-5 bg-ink" />
          <span className="h-[2px] w-5 bg-ink" />
          <span className="h-[2px] w-5 bg-ink" />
        </button>
      </header>
      {open && <div className="border-b border-[#F0EDE9] bg-white px-4 py-4 lg:hidden">{nav}</div>}

      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-line bg-white p-5 lg:block">
          <Link href="/admin" className="flex items-center gap-2.5">
            <span className="font-display text-[17px] font-bold tracking-tight text-ink">
              Delicate
            </span>
            <BrandDots />
          </Link>
          <p className="mt-0.5 text-xs text-muted">
            Ops console · {me.data.user.platformRole.replace("_", " ")}
          </p>
          <div className="mt-7">{nav}</div>
          <Link href="/portal" className="link-quiet mt-8 block text-xs">
            ← Customer portal
          </Link>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
