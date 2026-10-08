"use client";

import Link from "next/link";
import { getSupabase } from "@/lib/supabase";

/**
 * The shared furniture of the sign-in and sign-up pages.
 *
 * They are the same page with a different verb, and the two drifting apart is how you end up
 * with a sign-up form that looks like it belongs to somebody else's product. One frame, one
 * field, one Google button.
 */
export function AuthShell({
  title,
  lede,
  children,
  footer,
}: {
  title: string;
  lede: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <Link href="/" className="font-display text-xl font-extrabold tracking-tight text-ink">
        Delicate Courier
        <span className="ml-1.5 inline-flex gap-[3px] align-middle">
          <Dot className="bg-[#E84A8A]" />
          <Dot className="bg-[#F7A8CE]" />
          <Dot className="bg-[#0A0A0A]" />
        </span>
      </Link>

      <h1 className="page-title mt-8">{title}</h1>
      <p className="lede mt-2">{lede}</p>

      {children}

      {footer && <p className="mt-6 text-center text-sm text-muted">{footer}</p>}
    </main>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`inline-block h-[5px] w-[5px] rounded-full ${className}`} />;
}

export function Field(props: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="field-label">{props.label}</span>
      <input
        type={props.type}
        value={props.value}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        minLength={props.minLength}
        required={props.required ?? true}
        onChange={(e) => props.onChange(e.target.value)}
        className="input mt-1.5"
      />
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

/**
 * Google is one button for both verbs: Supabase creates the identity if it does not know the
 * address and signs them in if it does, so offering "sign up with Google" and "sign in with
 * Google" as different controls would be a distinction with nothing behind it.
 */
export function GoogleButton({
  next,
  label,
  onError,
}: {
  next: string;
  label: string;
  onError: (message: string) => void;
}) {
  async function go() {
    const supabase = getSupabase();
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    // signInWithOAuth normally navigates away, so reaching here with an error means it never
    // got that far — usually the provider is not enabled on the project.
    if (error) onError(error.message);
  }

  return (
    <button type="button" onClick={go} className="btn btn-secondary w-full">
      <GoogleMark />
      {label}
    </button>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px]" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.47.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted">
      <span className="h-px flex-1 bg-line" />
      {children}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Only allow same-origin relative redirects: `next` arrives from the query string. */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/portal";
  return value;
}
