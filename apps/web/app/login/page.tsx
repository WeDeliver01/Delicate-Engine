"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseEnabled } from "@/lib/env";
import { getSupabase, supabaseMisconfigured } from "@/lib/supabase";
import { setDevToken } from "@/lib/session";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [devToken, setDev] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Say it up front: this is wrong before anyone types a password, not after.
  const misconfigured = supabaseMisconfigured();
  const [busy, setBusy] = useState(false);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (misconfigured) return setError(misconfigured);
    const supabase = getSupabase();
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace(next);
  }

  async function signInWithGoogle() {
    if (misconfigured) return setError(misconfigured);
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  }

  function useDevToken(e: React.FormEvent) {
    e.preventDefault();
    if (!devToken.trim())
      return setError("paste a token from `pnpm --filter @delicate/api run dev:token`");
    setDevToken(devToken.trim());
    router.replace(next);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-[#6B6661]">Delicate Courier portal</p>

      {supabaseEnabled ? (
        <form onSubmit={signInWithPassword} className="mt-8 space-y-4">
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          <button
            disabled={busy}
            className="w-full rounded-xl bg-ink py-2 font-medium text-white disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={signInWithGoogle}
            className="w-full rounded-xl border border-[#DAD6CF] py-2 font-medium"
          >
            Continue with Google
          </button>
        </form>
      ) : (
        <form onSubmit={useDevToken} className="mt-8 space-y-4">
          <div className="rounded-xl border border-[#F7A8CE] bg-[#FCEEF4] p-3 text-sm text-ink">
            Supabase is not configured. Local development uses a dev token from the API:
            <code className="mt-1 block text-xs">
              pnpm --filter @delicate/api run dev:token owner
            </code>
          </div>
          <label className="block text-sm">
            <span className="font-medium">Dev token</span>
            <textarea
              value={devToken}
              onChange={(e) => setDev(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-xl border border-[#DAD6CF] p-2 font-mono text-xs"
            />
          </label>
          <button className="w-full rounded-xl bg-ink py-2 font-medium text-white">
            Use token
          </button>
        </form>
      )}

      {error && <p className="mt-4 text-sm text-[#C13B73]">{error}</p>}
    </main>
  );
}

function Field(props: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{props.label}</span>
      <input
        type={props.type}
        value={props.value}
        autoComplete={props.autoComplete}
        onChange={(e) => props.onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-[#DAD6CF] p-2"
        required
      />
    </label>
  );
}

/** Only allow same-origin relative redirects. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/portal";
  return value;
}
