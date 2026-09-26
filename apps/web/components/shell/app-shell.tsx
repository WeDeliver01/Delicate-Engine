"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandDots } from "@/components/ui";

export interface NavItem {
  href: string;
  label: string;
  /** Material Symbols Outlined ligature, e.g. "local_shipping". */
  icon: string;
  /** Rendered as a count bubble on the right; hidden when zero or undefined. */
  badge?: number;
  /** Matched exactly rather than by prefix, for a section's own index route. */
  exact?: boolean;
}

export interface NavSection {
  group: string;
  items: NavItem[];
}

/**
 * The one shell both the portal and the ops console sit in.
 *
 * A sidebar rather than a top bar because the navigation is too deep to fit across a header
 * without hiding most of it, and because the vertical space is free: the content beside it is
 * tables and forms, which want width, not height.
 *
 * `footer` is the slot at the bottom, holding the account switcher in the portal and the
 * signed-in user in the console. It lives down there because switching accounts is something
 * you do rarely and deliberately, and the top-left corner is worth more to the work itself.
 */
export function AppShell({
  home,
  title,
  subtitle,
  nav,
  footer,
  aside,
  children,
}: {
  home: string;
  title: string;
  subtitle?: string;
  nav: NavSection[];
  footer: ReactNode;
  /** A quiet link above the footer, e.g. crossing between portal and console. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // A tap inside the mobile drawer should close it; without this it stays open over the page
  // it just navigated to.
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : (pathname?.startsWith(item.href) ?? false);

  const links = (
    <nav className="space-y-6">
      {nav.map((section) => (
        <div key={section.group}>
          <p className="label-mini px-2.5">{section.group}</p>
          <ul className="mt-2 space-y-0.5">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-2.5 rounded-xl px-2.5 py-[7px] text-sm transition-colors ${
                    isActive(item)
                      ? "bg-[#FCEEF4] font-medium text-[#C13B73]"
                      : "text-[#6B6661] hover:bg-[#FAFAF9] hover:text-ink"
                  }`}
                >
                  <span
                    className="material-symbols-outlined text-[19px] leading-none"
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.badge ? (
                    <span className="chip chip-bad figure px-1.5 py-0 text-[10px]">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  ) : null}
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
      {/* Mobile bar. The drawer holds the same links, so nothing is desktop-only. */}
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-[#F0EDE9] bg-white px-4 py-3 lg:hidden">
        <Link href={home} className="flex items-center gap-2.5">
          <span className="font-display text-[15px] font-bold tracking-tight text-ink">
            {title}
          </span>
          <BrandDots />
        </Link>
        <button
          onClick={() => setOpen(!open)}
          aria-label="Menu"
          aria-expanded={open}
          className="flex flex-col gap-[5px] p-2"
        >
          <span className="h-[2px] w-5 bg-ink" />
          <span className="h-[2px] w-5 bg-ink" />
          <span className="h-[2px] w-5 bg-ink" />
        </button>
      </header>
      {open && (
        <div className="border-b border-[#F0EDE9] bg-white px-4 py-4 lg:hidden">
          {links}
          <div className="mt-6">{footer}</div>
        </div>
      )}

      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-line bg-white lg:flex">
          <div className="px-5 pt-5">
            <Link href={home} className="flex items-center gap-2.5">
              <span className="font-display text-[17px] font-bold tracking-tight text-ink">
                Delicate
              </span>
              <BrandDots />
            </Link>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>

          {/* The links scroll; the footer stays put, so the account you are acting as is always
              visible however far down the navigation you have gone. */}
          <div className="mt-7 min-h-0 flex-1 overflow-y-auto px-5 pb-4">{links}</div>

          <div className="border-t border-line p-3">
            {aside && <div className="px-2 pb-2">{aside}</div>}
            {footer}
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}

/**
 * The bottom-of-sidebar identity block: who you are, which account you are acting as, and a
 * popover to change it. One control, because "who am I" and "who am I acting as" are the same
 * question to the person asking it.
 */
export function IdentityFooter({
  name,
  meta,
  accounts,
  activeAccountId,
  onSwitch,
  newAccountHref,
  actions,
}: {
  name: string;
  meta: string;
  accounts?: { id: string; name: string }[];
  activeAccountId?: string | null;
  onSwitch?: (id: string) => void;
  newAccountHref?: string;
  actions?: { label: string; href?: string; onClick?: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const initials =
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";

  return (
    <div ref={box} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-full min-w-56 rounded-xl border border-line bg-white p-1.5 shadow-lg">
          {accounts && accounts.length > 0 && (
            <>
              <p className="label-mini px-2.5 py-1.5">Switch account</p>
              <ul className="max-h-56 overflow-y-auto">
                {accounts.map((a) => (
                  <li key={a.id}>
                    <button
                      onClick={() => {
                        onSwitch?.(a.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-[#FAFAF9] ${
                        a.id === activeAccountId ? "font-medium text-ink" : "text-[#6B6661]"
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined text-[17px] ${
                          a.id === activeAccountId ? "text-brand-pink" : "text-transparent"
                        }`}
                        aria-hidden="true"
                      >
                        check
                      </span>
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {newAccountHref && (
                <Link
                  href={newAccountHref}
                  onClick={() => setOpen(false)}
                  className="mt-0.5 block rounded-lg px-2.5 py-1.5 text-sm text-brand-pink hover:bg-[#FCEEF4]"
                >
                  + New account
                </Link>
              )}
              {actions && actions.length > 0 && <hr className="my-1.5 border-line" />}
            </>
          )}
          {actions?.map((a) =>
            a.href ? (
              <Link
                key={a.label}
                href={a.href}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-2.5 py-1.5 text-sm text-[#6B6661] hover:bg-[#FAFAF9] hover:text-ink"
              >
                {a.label}
              </Link>
            ) : (
              <button
                key={a.label}
                onClick={() => {
                  a.onClick?.();
                  setOpen(false);
                }}
                className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[#6B6661] hover:bg-[#FAFAF9] hover:text-ink"
              >
                {a.label}
              </button>
            ),
          )}
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[#FAFAF9]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FCEEF4] text-[11px] font-bold text-[#C13B73]">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ink">{name}</span>
          <span className="block truncate text-[11.5px] text-muted">{meta}</span>
        </span>
        <span className="material-symbols-outlined text-[18px] text-muted" aria-hidden="true">
          unfold_more
        </span>
      </button>
    </div>
  );
}
