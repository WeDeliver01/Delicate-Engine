"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The shared vocabulary for the portal and the ops console.
 *
 * These are the same shapes the marketing site uses — hairline cards on warm white, Manrope
 * headings, pill buttons that turn pink — expressed once so a screen is assembled from the
 * design system rather than from hex codes. The classes themselves live in `globals.css`.
 */

/** The three dots that end the wordmark: pink, yellow, purple. */
export function BrandDots({ className = "" }: { className?: string }) {
  return (
    <span className={`flex gap-1 ${className}`}>
      <span className="h-[7px] w-[7px] rounded-full bg-brand-pink" />
      <span className="h-[7px] w-[7px] rounded-full bg-brand-yellow" />
      <span className="h-[7px] w-[7px] rounded-full bg-brand-purple" />
    </span>
  );
}

export function Wordmark({ href = "/", subtitle }: { href?: string; subtitle?: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-2.5">
      <span className="whitespace-nowrap font-display text-[17px] font-bold tracking-tight text-ink">
        Delicate Courier
      </span>
      <BrandDots />
      {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
    </Link>
  );
}

/** Page heading with the marketing site's eyebrow / title / lede rhythm. */
export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {lede && <p className="lede mt-2">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  footer,
  className = "",
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-head">
          <div>
            {title && <h2 className="section-title">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
      {footer && <div className="panel-note">{footer}</div>}
    </section>
  );
}

/** A single number worth looking at. `tone` colours the figure, not the card. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "good" | "warn" | "bad";
}) {
  const colour =
    tone === "good"
      ? "text-[#1B7F4B]"
      : tone === "warn"
        ? "text-[#8A5A12]"
        : tone === "bad"
          ? "text-[#C13B73]"
          : "text-ink";
  return (
    <div className="panel p-4">
      <div className="label-mini">{label}</div>
      <div className={`figure mt-1.5 text-lg ${colour}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const CHIP_TONES = {
  neutral: "chip-neutral",
  good: "chip-good",
  warn: "chip-warn",
  bad: "chip-bad",
  info: "chip-info",
  outline: "chip-outline",
} as const;

export function Chip({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof CHIP_TONES;
  children: ReactNode;
}) {
  return <span className={`chip ${CHIP_TONES[tone]}`}>{children}</span>;
}

/** Said in the same voice everywhere: what is missing, and what to do about it. */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="panel p-10 text-center text-sm text-muted">{children}</div>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="checkbox mt-0.5"
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Errors and confirmations, in one voice rather than five. */
export function Notice({
  tone,
  children,
}: {
  tone: "error" | "success" | "info";
  children: ReactNode;
}) {
  if (!children) return null;
  const cls =
    tone === "error" ? "alert-error" : tone === "success" ? "alert-success" : "alert-info";
  return <p className={cls}>{children}</p>;
}
