"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseEnabled } from "@/lib/env";
import { getSupabase, supabaseMisconfigured } from "@/lib/supabase";
import { setDevToken } from "@/lib/session";
import { AuthShell, Divider, Field, GoogleButton, safeNext } from "@/components/auth/auth-ui";

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
  const [notice, setNotice] = useState<string | null>(null);
  // Say it up front: this is wrong before anyone types a password, not after.
  const misconfigured = supabaseMisconfigured();
  const [busy, setBusy] = useState(false);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (misconfigured) return setError(misconfigured);
    const supabase = getSupabase();
    if (!supabase) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace(next);
  }

  /**
   * Supabase sends the reset link; the callback exchanges it for a session and drops them in
   * the portal, where they can set a new password from their profile.
   */
  async function resetPassword() {
    if (misconfigured) return setError(misconfigured);
    if (!email.trim()) return setError("Type your email address first, then ask for the link.");
    const supabase = getSupabase();
    if (!supabase) return;

    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset`,
    });
    if (error) return setError(error.message);
    setNotice(`If we know ${email.trim()}, a reset link is on its way.`);
  }

  function useDevToken(e: React.FormEvent) {
    e.preventDefault();
    if (!devToken.trim())
      return setError("paste a token from `pnpm --filter @delicate/api run dev:token`");
    setDevToken(devToken.trim());
    router.replace(next);
  }

  return (
    <AuthShell
      title="Sign in"
      lede="Your deliveries, wallet and invoices."
      footer={
        supabaseEnabled ? (
          <>
            New to Delicate Courier?{" "}
            <Link href={`/signup?next=${encodeURIComponent(next)}`} className="link-accent">
              Create an account
            </Link>
          </>
        ) : (
          <Link href="/" className="link-quiet">
            Back to the site
          </Link>
        )
      }
    >
      {supabaseEnabled ? (
        <>
          <div className="mt-8 space-y-4">
            <GoogleButton next={next} label="Continue with Google" onError={setError} />
            <Divider>or</Divider>
          </div>

          <form onSubmit={signInWithPassword} className="mt-4 space-y-4">
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
            />
            <div>
              <Field
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
              />
              <button type="button" onClick={resetPassword} className="link-quiet mt-1.5 text-xs">
                Forgot your password?
              </button>
            </div>
            {error && <p className="alert-error">{error}</p>}
            {notice && <p className="alert-success">{notice}</p>}
            <button disabled={busy} className="btn btn-primary w-full">
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </>
      ) : (
        <form onSubmit={useDevToken} className="mt-8 space-y-4">
          <div className="alert-info">
            Supabase is not configured. Local development uses a dev token from the API:
            <code className="mt-1 block text-xs">
              pnpm --filter @delicate/api run dev:token owner
            </code>
          </div>
          <label className="block">
            <span className="field-label">Dev token</span>
            <textarea
              value={devToken}
              onChange={(e) => setDev(e.target.value)}
              rows={4}
              className="input mt-1.5 font-mono text-xs"
            />
          </label>
          {error && <p className="alert-error">{error}</p>}
          <button className="btn btn-primary w-full">Use token</button>
        </form>
      )}
    </AuthShell>
  );
}
