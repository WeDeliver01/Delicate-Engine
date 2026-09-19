import Link from "next/link";

/**
 * Marketing landing page (Phase 0 scaffold). Copy and sections come from the approved copy
 * deck in Phase 4; for now it establishes the route, the nav and the two calls to action that
 * hand off into the portal.
 */
export default function HomePage() {
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Delicate Courier
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/login" className="hover:underline">
            Sign in
          </Link>
          <Link
            href="/login?next=/portal/book"
            className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700"
          >
            Book a delivery
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-24">
        <p className="text-sm font-medium uppercase tracking-widest text-amber-600">
          Pretoria · Tshwane
        </p>
        <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-tight tracking-tight">
          Delicate deliveries, handled by people who care.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-slate-600">
          Same-day and next-day courier for bakeries, florists and businesses whose parcels
          can&apos;t be thrown in the back of a van. Book online, track live, pay from your account.
        </p>
        <div className="mt-10 flex gap-4">
          <Link
            href="/login?next=/portal"
            className="rounded-md bg-slate-900 px-6 py-3 font-medium text-white hover:bg-slate-700"
          >
            Open the portal
          </Link>
          <Link
            href="/login?next=/portal/accounts/new"
            className="rounded-md border border-slate-300 px-6 py-3 font-medium hover:bg-slate-50"
          >
            Create an account
          </Link>
        </div>
      </section>
    </main>
  );
}
