"use client";

import { Suspense, useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { AuthShell, safeNext } from "@/components/auth/auth-ui";

/**
 * Completes a sign-up confirmation, password reset or resend from a token hash rather than a
 * PKCE code. The hash is checked against Supabase directly, with nothing stored in the browser
 * that started the flow — so the link opens in whichever browser or mail app the customer
 * actually taps it in, which is usually not the one they signed up from.
 *
 * OAuth still goes through /auth/callback: a code exchange is fine there, because the whole
 * redirect stays inside one browser anyway.
 */
export default function AuthConfirmPage() {
  return (
    <Suspense>
      <Confirm />
    </Suspense>
  );
}

function Confirm() {
  const router = useRouter();
  const params = useSearchParams();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    const tokenHash = params.get("token_hash");
    const type = params.get("type") as EmailOtpType | null;
    const next = safeNext(params.get("next"));

    if (!supabase || !tokenHash || !type) {
      router.replace("/login");
      return;
    }
    supabase.auth
      .verifyOtp({ type, token_hash: tokenHash })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          // The reason is for whoever reads the logs, not for the customer — see auth/callback
          // for why the raw provider message no longer reaches this screen.
          console.error("auth/confirm: verifyOtp failed:", error.message);
          setFailed(true);
        } else {
          router.replace(next);
        }
      });
  }, [params, router]);

  if (failed) {
    return (
      <AuthShell
        title="That link has expired"
        lede="Links like this are good for one use and a short while. Ask for a fresh one and open it again."
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
