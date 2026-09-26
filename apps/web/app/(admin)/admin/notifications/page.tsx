"use client";

import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  NOTIFICATION_GROUPS,
  type AdminCopySettings,
  type Notification,
  type NotificationChannelStatus,
  type NotificationKind,
  type NotificationStatus,
  type NotificationTemplate,
  type SettingsBundle,
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
  const settings = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api<SettingsBundle>("/v1/admin/settings"),
  });
  const requeue = useMutation({
    mutationFn: (id: string) =>
      api(`/v1/admin/notifications/${id}/requeue`, { method: "POST", json: {} }),
    onSuccess: invalidate,
    onError,
  });

  return (
    <div className="space-y-6">
      {error && <p className="alert-error">{error}</p>}

      <header>
        <h1 className="page-title">Notifications</h1>
        <p className="text-sm text-muted">
          Every message is written down before it is sent, and nothing is ever discarded — a channel
          with no provider records what it would have said.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {channels.data?.map((c) => (
          <div
            key={c.channel}
            className={`rounded-xl border p-4 ${c.configured ? "border-line bg-white" : "border-[#F7D9A8] bg-[#FDF3E3]"}`}
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
            <p className="mt-1 text-center text-[10px] uppercase text-muted">last 24 hours</p>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="section-title">Messages</h2>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as NotificationStatus | "")}
            className="input px-2 py-1 text-sm"
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
          <thead className="label-mini">
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
                  <td className="px-5 py-2 text-muted">{dateTime(n.createdAt)}</td>
                  <td className="px-5 py-2">
                    <button
                      onClick={() => setOpen(open === n.id ? null : n.id)}
                      className="hover:underline"
                    >
                      {n.kind}
                    </button>
                    <div className="text-xs text-muted">{n.audience}</div>
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
                        className="text-xs text-brand-pink hover:underline"
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
                        <p className="mt-3 rounded-xl bg-white p-3 text-xs text-[#8A5A12]">
                          {n.detail}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-muted">
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
                <td colSpan={6} className="table-empty">
                  Nothing sent yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {settings.data && (
        <AdminCopyPanel
          value={settings.data.adminCopy}
          onSaved={() => void qc.invalidateQueries({ queryKey: ["admin", "settings"] })}
          onError={onError}
        />
      )}

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
    <section className="panel">
      <div className="border-b border-line px-5 py-4">
        <h2 className="section-title">Templates</h2>
        <p className="text-xs text-muted">
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
              <span className="text-muted">
                {t.channel} · to the {t.audience}
              </span>
              {!t.enabled && <span className="chip chip-neutral">off</span>}
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
          <span className="label-mini">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1 w-full input"
          />
        </label>
      )}
      <label className="block">
        <span className="label-mini">Message</span>
        <textarea
          value={body}
          rows={10}
          onChange={(e) => setBody(e.target.value)}
          className="mt-1 w-full input font-mono text-xs"
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
          className="ml-auto rounded-full bg-ink px-5 py-2 text-white hover:bg-brand-pink disabled:opacity-40"
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
      <dt className="text-[10px] uppercase text-muted">{label}</dt>
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

/**
 * Who inside the business is copied on outbound mail.
 *
 * The default copies everything, which is what was asked for and is a great deal of mail. The
 * count is shown honestly next to the choice, and narrowing it costs nothing: every message is
 * recorded and searchable in the list below whether or not a copy was posted to anyone.
 */
function AdminCopyPanel({
  value,
  onSaved,
  onError,
}: {
  value: AdminCopySettings;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [draft, setDraft] = useState<AdminCopySettings>(value);
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  const save = useMutation({
    mutationFn: () =>
      api<AdminCopySettings>("/v1/admin/settings/admin-copy", { method: "PUT", json: draft }),
    onSuccess: onSaved,
    onError,
  });

  const all = draft.kinds === "all";
  // Narrowed into a local, because `draft.kinds` reads as the union again on every access.
  const selected: NotificationKind[] = draft.kinds === "all" ? [] : draft.kinds;
  const everyKind = NOTIFICATION_GROUPS.flatMap((g) => g.kinds) as NotificationKind[];

  const toggle = (kind: NotificationKind) => {
    const current = all ? everyKind : selected;
    const next = current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind];
    setDraft({ ...draft, kinds: next });
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2 className="section-title">Copy to the office</h2>
          <p className="lede">A blind copy of outbound email to one internal address.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            className="checkbox"
          />
          Enabled
        </label>
      </div>

      <div className="panel-body space-y-4">
        <label className="block max-w-sm">
          <span className="field-label">Address</span>
          <input
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            className="input mt-1"
          />
        </label>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setDraft({ ...draft, kinds: "all" })}
            className={`chip ${all ? "bg-ink text-white" : "chip-outline hover:border-ink"}`}
          >
            Everything
          </button>
          <button
            type="button"
            onClick={() =>
              setDraft({
                ...draft,
                // The ones with a human decision behind them: a failed booking needs chasing,
                // a sign-up may need a call, money arriving should be seen.
                kinds: [
                  "account.created",
                  "booking.rejected",
                  "booking.cancelled",
                  "shipment.failed",
                  "shipment.change_requested",
                  "wallet.topped_up",
                ],
              })
            }
            className="chip chip-outline hover:border-ink"
          >
            Only what needs a person
          </button>
        </div>

        {all && (
          <p className="alert-info">
            Copying everything means a message for every status change on every shipment. At a few
            hundred shipments a month that is thousands of emails, and the handful that need acting
            on get lost among them. Everything is recorded below either way.
          </p>
        )}

        {!all && (
          <div className="space-y-3">
            {NOTIFICATION_GROUPS.map((g) => (
              <div key={g.group}>
                <p className="label-mini">{g.group}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(g.kinds as NotificationKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => toggle(k)}
                      className={`chip ${
                        selected.includes(k)
                          ? "bg-brand-pink text-white"
                          : "chip-outline hover:border-ink"
                      }`}
                    >
                      {k.split(".")[1]?.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate()}
          className="btn btn-primary btn-sm"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
