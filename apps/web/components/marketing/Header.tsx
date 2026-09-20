"use client";

import { useState, useRef, useEffect } from "react";
import { Menu, X, ChevronDown } from "lucide-react";
import { LINKS, NAV_LINKS, COMPANY_LINKS, SITE } from "@/lib/constants";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-br from-[#F8F6F3] backdrop-blur-sm border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* ── Logo + Brand name ── */}
          <a href="/" className="flex items-center gap-2.5 shrink-0">
            <img src="/images/logo.png" alt="Delicate Courier Logo" className="h-20 w-auto" />
            <span className="text-black font-bold text-xl tracking-tight">Delicate Courier</span>
          </a>

          {/* ── Desktop Nav ── */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                className={`text-sm px-3 py-2 rounded-md transition-colors ${
                  link.label === "BOOK A SHIPMENT"
                    ? "text-white font-medium hover:opacity-90"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
                style={
                  link.label === "BOOK A SHIPMENT" ? { backgroundColor: "#E84A8A" } : undefined
                }
              >
                {link.label}
              </a>
            ))}

            {/* Company dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-1 text-sm px-3 py-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
              >
                Company
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 top-12 mt-1 w-56 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg py-1 z-50">
                  {COMPANY_LINKS.map((link) => (
                    <a
                      key={link.label}
                      href={link.href}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noopener noreferrer" : undefined}
                      onClick={() => setDropdownOpen(false)}
                      className="block px-4 py-2.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Track link */}
            <a
              href={LINKS.track}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm px-3 py-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
            >
              Track
            </a>
          </nav>

          {/* ── Mobile Hamburger ── */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 text-gray-600 hover:text-gray-900 transition-colors"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* ── Mobile Menu ── */}
      {menuOpen && (
        <div className="md:hidden border-t border-gray-100 backdrop-blur-sm max-h-[70vh] overflow-y-auto">
          <nav className="flex flex-col px-4 py-4 gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                onClick={() => setMenuOpen(false)}
                className={`text-sm px-3 py-2.5 rounded-md transition-colors ${
                  link.label === "BOOK A SHIPMENT"
                    ? "text-white font-medium text-center mt-1 hover:opacity-90"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
                style={
                  link.label === "BOOK A SHIPMENT" ? { backgroundColor: "#E84A8A" } : undefined
                }
              >
                {link.label}
              </a>
            ))}

            <div className="pt-2 mt-2 border-t border-gray-100">
              <p className="text-xs font-medium text-white uppercase tracking-widest px-3 py-1 mb-1">
                Company
              </p>
              {COMPANY_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target={link.external ? "_blank" : undefined}
                  rel={link.external ? "noopener noreferrer" : undefined}
                  onClick={() => setMenuOpen(false)}
                  className="block text-sm px-3 py-2.5 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>

            <div className="pt-2 mt-1 border-t border-gray-100">
              <a
                href={LINKS.track}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOpen(false)}
                className="block text-sm px-3 py-2.5 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
              >
                Track a Delivery
              </a>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
