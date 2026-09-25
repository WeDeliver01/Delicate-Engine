"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Notification, NotificationPreferences } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime, rands } from "@/lib/money";

/** How we may contact you and your recipients, and everything we have sent on your behalf. */
export default function PortalNotifications() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const prefs = useQuery({
    queryKey: ["portal", "notification-preferences"],
    queryFn: () => api<NotificationPreferences>("/v1/account/notifications/preferences"),
  });
  const history = useQuery({
    queryKey: ["portal", "notifications"],
    queryFn: () => api<Notification[]>("/v1/account/notifications?limit=50"),
  });

  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  useEffect(() => {
    if (prefs.data) setDraft(prefs.data);
  }, [prefs.data]);

  const save = useMutation({
    mutationFn: (body: NotificationPreferences) =>
      api("/v1/account/notifications/preferences", { method: "PUT", json: body }),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ["portal"] });
    },
    onError: (e: unknown) => {
      setSaved(false);
      setError(e instanceof ApiRequestError ? e.message : String(e));
    },
  });

  if (!draft) return <p className="p-10 text-sm text-[#86817A]">Loading…</p>;
  const set = (patch: Partial<NotificationPreferences>) => {
    setSaved(false);
    setDraft({ ...draft, ...patch });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="mt-1 text-sm text-[#6B6661]">
          How we keep you and the people receiving your parcels informed.
        </p>
      </header>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-xl border border-[#BEE3CD] bg-[#E7F5EC] p-3 text-sm text-[#1B7F4B]">
          Saved.
        </p>
      )}

      <section className="rounded-2xl border border-[#ECEAE6] bg-white p-6">
        <h2 className="font-semibold">How we reach you</h2>
        <div className="mt-4 space-y-3 text-sm">
          <Toggle
            label="Email"
            hint="Booking confirmations, delivery updates and invoices."
            checked={draft.email}
            onChange={(v) => set({ email: v })}
          />
          <Toggle
            label="SMS"
            hint="Short updates when something needs your attention."
            checked={draft.sms}
            onChange={(v) => set({ sms: v })}
          />
          <Toggle
            label="WhatsApp"
            hint="Not switched on yet — we will ask before we use it."
            checked={draft.whatsapp}
            onChange={(v) => set({ whatsapp: v })}
          />
        </div>

        <h2 className="mt-8 font-semibold">Your recipients</h2>
        <div className="mt-4 space-y-3 text-sm">
          <Toggle
            label="Let us message the person receiving the parcel"
            hint="They get a text when the driver collects, and when it arrives. Most people expecting a cake want this."
            checked={draft.notifyRecipients}
            onChange={(v) => set({ notifyRecipients: v })}
          />
        </div>

        <h2 className="mt-8 font-semibold">Wallet</h2>
        <label className="mt-3 block max-w-xs text-sm">
          <span className="text-xs uppercase text-[#86817A]">Warn me below (rands)</span>
          <input
            type="number"
            value={draft.lowBalanceCents / 100}
            onChange={(e) => set({ lowBalanceCents: Math.round(Number(e.target.value) * 100) })}
            className="mt-1 w-full rounded-lg border border-[#DAD6CF] px-3 py-2 font-mono"
          />
          <span className="mt-1 block text-xs text-[#86817A]">
            Currently {rands(draft.lowBalanceCents)}.
          </span>
        </label>

        <button
          onClick={() => save.mutate(draft)}
          disabled={save.isPending}
          className="mt-6 rounded-full bg-[#0A0A0A] px-5 py-2 text-sm text-white hover:bg-[#E84A8A] disabled:opacity-40"
        >
          Save preferences
        </button>
      </section>

      <section className="rounded-2xl border border-[#ECEAE6] bg-white">
        <h2 className="border-b border-[#ECEAE6] px-6 py-4 font-semibold">What we have sent</h2>
        <ul className="divide-y divide-[#F0EDE9] text-sm">
          {history.data?.map((n) => (
            <li key={n.id} className="px-6 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{n.subject ?? n.kind.replace(/[._]/g, " ")}</span>
                <span className="text-xs text-[#86817A]">
                  {n.channel} · {n.to}
                </span>
                <span className="ml-auto text-xs text-[#86817A]">{dateTime(n.createdAt)}</span>
              </div>
              {n.status !== "sent" && (
                <p className="mt-1 text-xs text-[#8A5A12]">
                  {n.status === "suppressed" ? "Not sent" : n.status} — {n.detail ?? "pending"}
                </p>
              )}
            </li>
          ))}
          {history.data?.length === 0 && (
            <li className="px-6 py-8 text-center text-[#86817A]">Nothing yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <span>
        {label}
        <span className="block text-xs text-[#86817A]">{hint}</span>
      </span>
    </label>
  );
}
