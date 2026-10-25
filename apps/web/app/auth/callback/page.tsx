"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { AuthShell, safeNext } from "@/components/auth/auth-ui";

/**
 * Completes the Supabase PKCE flow. Only OAuth (Google) sends anyone here now — email
 * confirmation, resend and password reset go through /auth/confirm instead, precisely because
 * PKCE keeps its verifier in the browser that started the flow and cannot complete anywhere
 * else. OAuth does not have that problem: the whole redirect stays in one browser.
 */
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
  const [error, setError] = useState(false);

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
    if (providerError) {
      console.error("auth/callback: provider returned an error:", providerError);
      return setError(true);
    }

    if (!supabase || !code) {
      router.replace("/login");
      return;
    }
    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          // Customers only ever see the sentence below — the raw message is for us, in the
          // console, not a paragraph on a page we expect a customer to read.
          console.error("auth/callback: exchangeCodeForSession failed:", error.message);
          setError(true);
        } else {
          router.replace(next);
        }
      });
  }, [params, router]);

  if (error) {
    return (
      <AuthShell
        title="That did not work"
        lede="Something went wrong connecting your Google account. Try again, or sign in with your email and password instead."
        footer={
          <Link href="/login" className="link-accent">
            Back to sign in
          </Link>
        }
      />
    );
  }

  return <AuthShell title="Signing you in" lede="One moment…" />;
}
