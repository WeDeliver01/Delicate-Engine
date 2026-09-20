"use client";

import { useState } from "react";

const NAV_LINKS = [
  { label: "Tracking", href: "/track", external: true },
  { label: "Plans", href: "/membership", external: false },
  { label: "Coverage", href: "/liability-cover", external: false },
  { label: "FAQs", href: "/faq", external: false },
];

export default function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white shadow-sm border-b border-[#F0EDE9]">
      <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2.5">
          <span className="text-[17px] font-bold tracking-tight text-[#0A0A0A]">
            Delicate Courier
          </span>
          <span className="flex gap-1">
            <span className="w-[7px] h-[7px] rounded-full bg-[#E84A8A]" />
            <span className="w-[7px] h-[7px] rounded-full bg-[#F4C430]" />
            <span className="w-[7px] h-[7px] rounded-full bg-[#7C5CFF]" />
          </span>
        </a>

        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="text-[14px] text-[#6B6661] hover:text-[#0A0A0A] transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-4">
          <a
            href="/login?next=/portal"
            className="text-[13.5px] text-[#6B6661] hover:text-[#0A0A0A] transition-all active:scale-95"
          >
            Login
          </a>
          <a
            href="/quote"
            className="bg-[#0A0A0A] text-white text-[13.5px] font-medium px-6 py-2.5 rounded-full hover:bg-[#E84A8A] transition-all active:scale-95"
          >
            Get a quote
          </a>
        </div>

        <button
          type="button"
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
          className="md:hidden flex flex-col gap-[5px] p-2"
        >
          <span
            className={`w-5 h-[1.5px] bg-[#0A0A0A] transition-transform ${open ? "translate-y-[6.5px] rotate-45" : ""}`}
          />
          <span
            className={`w-5 h-[1.5px] bg-[#0A0A0A] transition-opacity ${open ? "opacity-0" : ""}`}
          />
          <span
            className={`w-5 h-[1.5px] bg-[#0A0A0A] transition-transform ${open ? "-translate-y-[6.5px] -rotate-45" : ""}`}
          />
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-[#F0EDE9] bg-white px-5 py-3">
          <nav className="flex flex-col">
            {NAV_LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                onClick={() => setOpen(false)}
                className="py-2.5 text-[15px] text-[#3A3631] border-b border-[#F4F2EF]"
              >
                {l.label}
              </a>
            ))}
            <a
              href="/login?next=/portal"
              onClick={() => setOpen(false)}
              className="py-2.5 text-[15px] text-[#3A3631] border-b border-[#F4F2EF]"
            >
              Login
            </a>
            <a
              href="/quote"
              onClick={() => setOpen(false)}
              className="mt-3 bg-[#0A0A0A] text-white text-center text-[14px] font-medium px-5 py-3 rounded-full"
            >
              Get a quote
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
