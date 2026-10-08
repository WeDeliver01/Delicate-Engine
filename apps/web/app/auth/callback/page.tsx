"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { AuthShell, safeNext } from "@/components/auth/auth-ui";

/** Completes the Supabase PKCE flow (OAuth, email confirmation, password reset) and redirects. */
export default function AuthCallbackPage() {
  return (
    <Suspense>
      <Callback />
    </Suspense>
  );
}

function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    const code = params.get("code");
    const next = safeNext(params.get("next"));

    /*
      The provider reports its own failures in the query string rather than by refusing to
      redirect — a declined Google consent screen arrives here as ?error=access_denied with no
      code at all. Read it, because the alternative is bouncing them to the login page with no
      explanation of what just happened.
    */
    const providerError = params.get("error_description") ?? params.get("error");
    if (providerError) return setError(providerError);

    if (!supabase || !code) {
      router.replace("/login");
      return;
    }
    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) setError(error.message);
        else router.replace(next);
      });
  }, [params, router]);

  if (error) {
    return (
      <AuthShell
        title="That did not work"
        /*
          Most often this is the cross-device case: PKCE keeps the verifier in the browser that
          started the flow, so a confirmation link opened on a phone cannot complete a sign-up
          begun on a laptop. The message has to point at that, because the raw error does not.
        */
        lede="If you opened the link on a different device or browser from the one you started in, it cannot complete there. Sign in with your email and password instead."
        footer={
          <Link href="/login" className="link-accent">
            Back to sign in
          </Link>
        }
      >
        <p className="alert-error mt-8">{error}</p>
      </AuthShell>
    );
  }

  return <AuthShell title="Signing you in" lede="One moment…" />;
}
