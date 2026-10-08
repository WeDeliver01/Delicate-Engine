"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseEnabled } from "@/lib/env";
import { getSupabase, supabaseMisconfigured } from "@/lib/supabase";
import { AuthShell, Divider, Field, GoogleButton, safeNext } from "@/components/auth/auth-ui";
import { useAuthProviders } from "@/components/auth/use-auth-providers";

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
  /*
    What the provider actually said, when we have replaced it with something kinder.
    Rewording an error is for the customer; throwing the original away is for nobody --
    "we could not send the email" with no reason is unfixable by whoever has to fix it.
  */
  const [detail, setDetail] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const misconfigured = supabaseMisconfigured();
  const providers = useAuthProviders();

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
        emailRedirectTo: confirmUrl(next),
      },
    });
    setBusy(false);
    if (error) return fail(error.message);

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

  /** Show our wording, and keep theirs where it differs. */
  function fail(providerMessage: string) {
    const friendly = readable(providerMessage);
    setError(friendly);
    setDetail(friendly === providerMessage ? null : providerMessage);
  }

  /** Nothing arrived. Usually spam, sometimes a typo, occasionally our mail is not sending. */
  async function resend() {
    const supabase = getSupabase();
    if (!supabase || !sentTo) return;
    setError(null);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: sentTo,
      options: { emailRedirectTo: confirmUrl(next) },
    });
    if (error) return fail(error.message);
    setResent(true);
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
        <div className="mt-4 space-y-3">
          {error && (
            <div className="alert-error">
              <p>{error}</p>
              {detail && <p className="mt-1.5 text-xs opacity-75">Reported as: {detail}</p>}
            </div>
          )}
          {resent ? (
            <p className="alert-success">Sent again. Check your spam folder too.</p>
          ) : (
            <button type="button" onClick={resend} className="btn btn-secondary btn-sm w-full">
              Nothing arrived — send it again
            </button>
          )}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      lede="Same-day delivery across Gauteng, for the things that cannot wait."
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
          {providers.signupDisabled && (
            <p className="alert-info mt-8">
              We are not taking new sign-ups at the moment. Email us and we will set you up.
            </p>
          )}
          {providers.google && (
            <div className="mt-8 space-y-4">
              <GoogleButton next={next} label="Continue with Google" onError={setError} />
              <Divider>or</Divider>
            </div>
          )}

          <form
            onSubmit={submit}
            className={providers.google ? "mt-4 space-y-4" : "mt-8 space-y-4"}
          >
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
            {error && (
              <div className="alert-error">
                <p>{error}</p>
                {detail && <p className="mt-1.5 text-xs opacity-75">Reported as: {detail}</p>}
              </div>
            )}
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

function confirmUrl(next: string): string {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

/**
 * Supabase's own wording, where it would leave someone stuck.
 *
 * The rate-limit message in particular reads as the customer's fault and is not: it means the
 * project is still on the built-in mail service, which sends a couple of messages an hour and
 * is not meant for production. They cannot fix that by waiting, so do not imply they can.
 */
function readable(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("rate limit") || m.includes("too many requests")) {
    return "We could not send the confirmation email just now. This is on our side — give us a moment, or email us and we will set your account up by hand.";
  }
  if (m.includes("error sending confirmation") || m.includes("sending email")) {
    return "We could not send the confirmation email. That is a fault on our side, not yours — please email us and we will set your account up.";
  }
  return message;
}
