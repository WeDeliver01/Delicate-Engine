"use client";

import { setActiveAccountId } from "@/lib/session";

/**
 * Says, loudly, that you are inside someone else's account.
 *
 * Deliberately the most prominent thing on the page and deliberately not dismissible. Somebody
 * who forgets whose account they are in books a real delivery against a real customer's wallet,
 * and the only thing between that and an apologetic refund is whether the page kept saying so.
 *
 * Leaving is one click, because a hard exit is what stops people staying in by accident.
 */
export function ActingAsBanner({ account }: { account: { id: string; name: string } }) {
  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-brand-pink bg-[#FCEEF4] px-4 py-3"
    >
      <p className="text-sm text-ink">
        <span
          className="material-symbols-outlined mr-1.5 align-[-4px] text-[18px] text-brand-pink"
          aria-hidden="true"
        >
          visibility
        </span>
        You are working inside <strong>{account.name}</strong>, not your own account. Anything you
        book here is charged to them, and every action is recorded against your name.
      </p>
      <button
        type="button"
        onClick={() => {
          setActiveAccountId(null);
          // A full load rather than a client navigation: every cached query on the page was
          // fetched as that account, and leaving one of them on screen is the exact confusion
          // this banner exists to prevent.
          window.location.assign("/admin");
        }}
        className="btn btn-sm bg-ink text-white hover:bg-brand-pink"
      >
        Stop and return to the console
      </button>
    </div>
  );
}
