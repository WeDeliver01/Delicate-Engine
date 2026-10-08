"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { AuthShell, Field } from "@/components/auth/auth-ui";

/**
 * Set a new password.
 *
 * Reached from the reset link, which the callback has already exchanged for a session — so by
 * the time anyone is here they are signed in, and all that is left is to write the password.
 * Guarded on the session anyway: arriving here directly, without the link, must not present a
 * form that cannot work.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return setReady(false);
    void supabase.auth
      .getSession()
      .then(({ data }: { data: { session: unknown } }) => setReady(Boolean(data.session)));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords do not match.");
    const supabase = getSupabase();
    if (!supabase) return;

    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace("/portal");
  }

  if (ready === null) {
    return <AuthShell title="One moment" lede="Checking your link…" />;
  }

  if (!ready) {
    return (
      <AuthShell
        title="That link has expired"
        lede="Reset links are good for one use and a short while. Ask for a fresh one."
        footer={
          <Link href="/login" className="link-accent">
            Back to sign in
          </Link>
        }
      />
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      lede="You are signed in. Set a password and we will take you to the portal."
    >
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={8}
          hint="At least 8 characters."
        />
        <Field
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          minLength={8}
        />
        {error && <p className="alert-error">{error}</p>}
        <button disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
    </AuthShell>
  );
}
