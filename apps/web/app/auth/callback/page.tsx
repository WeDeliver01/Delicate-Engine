"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

/** Completes the Supabase PKCE flow (OAuth, magic link, password reset) and redirects. */
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
    const next = params.get("next") ?? "/portal";
    if (!supabase || !code) {
      router.replace("/login");
      return;
    }
    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) setError(error.message);
        else router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/portal");
      });
  }, [params, router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4 text-sm text-[#6B6661]">
      {error ? <p className="text-red-600">{error}</p> : <p>Signing you in…</p>}
    </main>
  );
}
