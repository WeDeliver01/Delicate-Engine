"use client";

import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Notification,
  NotificationChannelStatus,
  NotificationStatus,
  NotificationTemplate,
} from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime } from "@/lib/money";

/**
 * What the business has told people, and what it could not. A channel with no provider still
 * records every message it would have sent, so the gap is visible rather than silent.
 */
export default function AdminNotifications() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<NotificationStatus | "">("");
  const [open, setOpen] = useState<string | null>(null);
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "notifications"] });

  const channels = useQuery({
    queryKey: ["admin", "notifications", "channels"],
    queryFn: () => api<NotificationChannelStatus[]>("/v1/admin/notifications/channels"),
    refetchInterval: 30_000,
  });
  const list = useQuery({
    queryKey: ["admin", "notifications", status],
    queryFn: () =>
      api<Notification[]>(`/v1/admin/notifications?limit=100${status ? `&status=${status}` : ""}`),
    refetchInterval: 30_000,
  });
  const templates = useQuery({
    queryKey: ["admin", "notifications", "templates"],
    queryFn: () => api<NotificationTemplate[]>("/v1/admin/notifications/templates"),
  });
  const requeue = useMutation({
    mutationFn: (id: string) =>
      api(`/v1/admin/notifications/${id}/requeue`, { method: "POST", json: {} }),
    onSuccess: invalidate,
    onError,
  });

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <header>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-sm text-[#86817A]">
          Every message is written down before it is sent, and nothing is ever discarded — a channel
          with no provider records what it would have said.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {channels.data?.map((c) => (
          <div
            key={c.channel}
            className={`rounded-xl border p-4 ${c.configured ? "border-[#ECEAE6] bg-white" : "border-[#F7D9A8] bg-[#FDF3E3]"}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold capitalize">{c.channel}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${c.configured ? "bg-[#E7F5EC] text-[#1B7F4B]" : "bg-white text-[#8A5A12]"}`}
              >
                {c.configured ? c.provider : "not configured"}
              </span>
            </div>
            {c.detail && <p className="mt-2 text-xs text-[#6B6661]">{c.detail}</p>}
            <dl className="mt-3 grid grid-cols-4 gap-1 text-center text-xs">
              <Metric label="queued" value={c.queued} />
              <Metric label="sent" value={c.sent24h} />
              <Metric
                label="failed"
                value={c.failed24h}
                tone={c.failed24h > 0 ? "bad" : undefined}
              />
              <Metric label="held" value={c.suppressed24h} />
            </dl>
            <p className="mt-1 text-center text-[10px] uppercase text-[#86817A]">last 24 hours</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-[#ECEAE6] bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#ECEAE6] px-5 py-4">
          <h2 className="font-semibold">Messages</h2>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as NotificationStatus | "")}
            className="rounded-lg border border-[#DAD6CF] px-2 py-1 text-sm"
          >
            <option value="">all</option>
            {["queued", "sent", "failed", "suppressed", "dead"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-[#86817A]">
            <tr>
              <th className="px-5 py-2">When</th>
              <th className="px-5 py-2">Kind</th>
              <th className="px-5 py-2">To</th>
              <th className="px-5 py-2">Channel</th>
              <th className="px-5 py-2">Status</th>
              <th className="px-5 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EDE9]">
            {list.data?.map((n) => (
              <Fragment key={n.id}>
                <tr>
                  <td className="px-5 py-2 text-[#86817A]">{dateTime(n.createdAt)}</td>
                  <td className="px-5 py-2">
                    <button
                      onClick={() => setOpen(open === n.id ? null : n.id)}
                      className="hover:underline"
                    >
                      {n.kind}
                    </button>
                    <div className="text-xs text-[#86817A]">{n.audience}</div>
                  </td>
                  <td className="px-5 py-2 font-mono text-xs">{n.to || "—"}</td>
                  <td className="px-5 py-2">{n.channel}</td>
                  <td className="px-5 py-2">
                    <StatusPill status={n.status} />
                  </td>
                  <td className="px-5 py-2 text-right">
                    {(n.status === "failed" || n.status === "dead") && (
                      <button
                        onClick={() => requeue.mutate(n.id)}
                        className="text-xs text-[#E84A8A] hover:underline"
                      >
                        try again
                      </button>
                    )}
                  </td>
                </tr>
                {open === n.id && (
                  <tr>
                    <td colSpan={6} className="bg-[#FAFAF9] px-5 py-4 text-sm">
                      {n.subject && <p className="font-medium">{n.subject}</p>}
                      <pre className="mt-2 whitespace-pre-wrap font-sans text-[#3F3B37]">
                        {n.body}
                      </pre>
                      {n.detail && (
                        <p className="mt-3 rounded-lg bg-white p-3 text-xs text-[#8A5A12]">
                          {n.detail}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-[#86817A]">
                        {n.attempts} attempt(s)
                        {n.sentAt ? ` · sent ${dateTime(n.sentAt)}` : ""}
                        {n.providerMessageId ? ` · ${n.providerMessageId}` : ""}
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-[#86817A]">
                  Nothing sent yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {templates.data && (
        <Templates templates={templates.data} onDone={invalidate} onError={onError} />
      )}
    </div>
  );
}

function Templates({
  templates,
  onDone,
  onError,
}: {
  templates: NotificationTemplate[];
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="rounded-xl border border-[#ECEAE6] bg-white">
      <div className="border-b border-[#ECEAE6] px-5 py-4">
        <h2 className="font-semibold">Templates</h2>
        <p className="text-xs text-[#86817A]">
          Your words, not ours. <span className="font-mono">{"{{ field }}"}</span> placeholders are
          filled per message; an unknown one renders empty rather than showing braces to a customer.
        </p>
      </div>
      <ul className="divide-y divide-[#F0EDE9]">
        {templates.map((t) => (
          <li key={t.id} className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <button
                onClick={() => setOpen(open === t.id ? null : t.id)}
                className="font-medium hover:underline"
              >
                {t.kind}
              </button>
              <span className="text-[#86817A]">
                {t.channel} · to the {t.audience}
              </span>
              {!t.enabled && (
                <span className="rounded-full bg-[#F0EDE9] px-2 py-0.5 text-xs text-[#6B6661]">
                  off
                </span>
              )}
            </div>
            {open === t.id && <TemplateForm template={t} onDone={onDone} onError={onError} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TemplateForm({
  template,
  onDone,
  onError,
}: {
  template: NotificationTemplate;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const [subject, setSubject] = useState(template.subject ?? "");
  const [body, setBody] = useState(template.body);
  const [enabled, setEnabled] = useState(template.enabled);
  const save = useMutation({
    mutationFn: () =>
      api(`/v1/admin/notifications/templates/${template.id}`, {
        method: "PUT",
        json: { subject: template.subject === null ? null : subject, body, enabled },
      }),
    onSuccess: onDone,
    onError,
  });

  return (
    <div className="mt-3 space-y-3 rounded-xl bg-[#FAFAF9] p-4 text-sm">
      {template.subject !== null && (
        <label className="block">
          <span className="text-xs uppercase text-[#86817A]">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[#DAD6CF] px-3 py-2"
          />
        </label>
      )}
      <label className="block">
        <span className="text-xs uppercase text-[#86817A]">Message</span>
        <textarea
          value={body}
          rows={10}
          onChange={(e) => setBody(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[#DAD6CF] px-3 py-2 font-mono text-xs"
        />
      </label>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          Send this one
        </label>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || body.trim().length === 0}
          className="ml-auto rounded-full bg-[#0A0A0A] px-5 py-2 text-white hover:bg-[#E84A8A] disabled:opacity-40"
        >
          Save template
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "bad" }) {
  return (
    <div>
      <dd className={`font-mono ${tone === "bad" ? "text-[#C13B73]" : ""}`}>{value}</dd>
      <dt className="text-[10px] uppercase text-[#86817A]">{label}</dt>
    </div>
  );
}

function StatusPill({ status }: { status: NotificationStatus }) {
  const tone: Record<NotificationStatus, string> = {
    queued: "bg-[#EAF1FB] text-[#1F4E8C]",
    sending: "bg-[#EAF1FB] text-[#1F4E8C]",
    sent: "bg-[#E7F5EC] text-[#1B7F4B]",
    failed: "bg-[#FDF3E3] text-[#8A5A12]",
    dead: "bg-[#FCEEF4] text-[#C13B73]",
    suppressed: "bg-[#F0EDE9] text-[#6B6661]",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs ${tone[status]}`}>{status}</span>;
}
