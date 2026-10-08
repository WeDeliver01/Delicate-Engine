"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseEnabled } from "@/lib/env";
import { getSupabase, supabaseMisconfigured } from "@/lib/supabase";
import { AuthShell, Divider, Field, GoogleButton, safeNext } from "@/components/auth/auth-ui";

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  // A new user has no account yet, so wherever they were headed, they go through onboarding
  // first. The portal sends them on from there.
  const next = safeNext(params.get("next"));
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const misconfigured = supabaseMisconfigured();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (misconfigured) return setError(misconfigured);
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    const supabase = getSupabase();
    if (!supabase) return;

    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // Carried in the token as user_metadata, which is where the engine reads the name
        // from when it provisions the profile on their first request.
        data: { full_name: fullName.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setBusy(false);
    if (error) return setError(error.message);

    // Confirmations switched off on the project: they are already signed in.
    if (data.session) return router.replace(next);

    /*
      Otherwise a confirmation email is on its way — and we say exactly that whether or not the
      address was already registered. Supabase deliberately returns a user with no identities
      for an address it already knows, rather than an error, because "that email is taken" on a
      public form tells a stranger who banks with us. We keep that property.
    */
    setSentTo(email.trim());
  }

  if (sentTo) {
    return (
      <AuthShell
        title="Check your email"
        lede={`We sent a confirmation link to ${sentTo}. Open it on this device to finish signing up.`}
        footer={
          <>
            Wrong address?{" "}
            <button type="button" onClick={() => setSentTo(null)} className="link-accent">
              Start again
            </button>
          </>
        }
      >
        <p className="alert-info mt-8">
          The link opens this site and signs you in. It only works in the browser you started in —
          if you open it on your phone instead, come back here and sign in with your email and
          password.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      lede="Same-day delivery across Pretoria and Tshwane. No monthly fee — you load what you need."
      footer={
        <>
          Already with us?{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="link-accent">
            Sign in
          </Link>
        </>
      }
    >
      {!supabaseEnabled ? (
        <p className="alert-info mt-8">
          Sign-up needs Supabase, which this build was not given. Use the dev token box on the{" "}
          <Link href="/login" className="link-accent">
            sign-in page
          </Link>{" "}
          instead.
        </p>
      ) : (
        <>
          <div className="mt-8 space-y-4">
            <GoogleButton next={next} label="Continue with Google" onError={setError} />
            <Divider>or</Divider>
          </div>

          <form onSubmit={submit} className="mt-4 space-y-4">
            <Field
              label="Your name"
              type="text"
              value={fullName}
              onChange={setFullName}
              autoComplete="name"
              placeholder="Thandi Mokoena"
              minLength={2}
            />
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              placeholder="you@business.co.za"
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              minLength={8}
              hint="At least 8 characters."
            />
            {error && <p className="alert-error">{error}</p>}
            <button disabled={busy} className="btn btn-primary w-full">
              {busy ? "Creating your account…" : "Create account"}
            </button>
            {/* No link yet: /terms and /privacy do not exist, and a dead link in the consent
                line is worse than no link. Make it an anchor once those pages are written. */}
            <p className="text-xs leading-relaxed text-muted">
              By creating an account you agree to our terms of service and to our handling your
              details as set out in our privacy notice.
            </p>
          </form>
        </>
      )}
    </AuthShell>
  );
}
