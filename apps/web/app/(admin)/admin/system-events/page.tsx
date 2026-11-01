"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SystemEvent, SystemEventLevel, SystemEventStats } from "@delicate/contracts";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/money";

/**
 * What just went wrong.
 *
 * The page Phase 8 was written for. A Bob Pay webhook refused every payment for two weeks and
 * the only trace was two hundred hours of container log, so the point of this screen is that
 * the next one of those is visible without an SSH session.
 *
 * Errors first in the header, and the category list is built from whatever the rows actually
 * contain rather than from a fixed set -- a new failure worth surfacing costs one line at the
 * call site, and this picks it up on its own.
 */
const LEVELS: { value: SystemEventLevel | ""; label: string }[] = [
  { value: "", label: "All levels" },
  { value: "error", label: "Errors" },
  { value: "warning", label: "Warnings" },
  { value: "info", label: "Info" },
];

const chipFor = (level: SystemEventLevel) =>
  level === "error" ? "chip chip-bad" : level === "warning" ? "chip chip-warn" : "chip";

export default function AdminSystemEventsPage() {
  const [level, setLevel] = useState<SystemEventLevel | "">("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [days, setDays] = useState(7);
  const [open, setOpen] = useState<SystemEvent | null>(null);

  const stats = useQuery({
    queryKey: ["admin", "system-events", "stats"],
    queryFn: () => api<SystemEventStats>("/v1/admin/system-events/stats?hours=24"),
    refetchInterval: 60_000,
  });

  const params = new URLSearchParams({ limit: "100" });
  if (level) params.set("level", level);
  if (category) params.set("category", category);
  if (q) params.set("q", q);
  params.set("from", new Date(Date.now() - days * 86_400_000).toISOString());

  const feed = useQuery({
    queryKey: ["admin", "system-events", level, category, q, days],
    queryFn: () =>
      api<{ items: SystemEvent[]; nextCursor: string | null }>(
        `/v1/admin/system-events?${params.toString()}`,
      ),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <header>
        <p className="label-mini text-[#E84A8A]">Engine</p>
        <h1 className="page-title">System events</h1>
        <p className="mt-1 text-sm text-muted">
          Operational failures and notable refusals — why a webhook was turned away, why a booking
          was refused, what errored. Not the audit log, which records what somebody changed on
          purpose, and not the outbox, which records whether an event reached its handlers.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["Errors", stats.data?.errors, "error"],
            ["Warnings", stats.data?.warnings, "warning"],
            ["Info", stats.data?.info, "info"],
          ] as const
        ).map(([label, count, lvl]) => (
          <button
            key={lvl}
            onClick={() => setLevel(level === lvl ? "" : lvl)}
            className={`panel p-5 text-left ${level === lvl ? "ring-2 ring-[#E84A8A]" : ""}`}
          >
            <p className="label-mini">{label}, last 24h</p>
            <p
              className={`mt-1 font-mono text-3xl ${
                lvl === "error" && (count ?? 0) > 0 ? "text-[#C13B73]" : ""
              }`}
            >
              {count ?? "—"}
            </p>
          </button>
        ))}
      </section>

      {/* Built from the rows, not from an enum: the categories are free text at the call site. */}
      {stats.data && stats.data.categories.length > 0 && (
        <section className="panel p-4">
          <p className="label-mini">Busiest categories, last 24h</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {stats.data.categories.slice(0, 12).map((c) => (
              <button
                key={`${c.category}:${c.level}`}
                onClick={() => setCategory(category === c.category ? "" : c.category)}
                className={`chip ${category === c.category ? "ring-2 ring-[#E84A8A]" : ""} ${
                  c.level === "error" ? "chip-bad" : c.level === "warning" ? "chip-warn" : ""
                }`}
              >
                {c.category} · {c.count}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as SystemEventLevel | "")}
            className="input px-2 py-1 text-sm"
          >
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category, e.g. webhook.bobpay"
            className="input px-2 py-1 text-sm"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the message"
            className="input px-2 py-1 text-sm"
          />
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="input px-2 py-1 text-sm"
          >
            {[1, 7, 30, 90].map((d) => (
              <option key={d} value={d}>
                Last {d} day{d === 1 ? "" : "s"}
              </option>
            ))}
          </select>
          {(level || category || q) && (
            <button
              onClick={() => {
                setLevel("");
                setCategory("");
                setQ("");
              }}
              className="link-quiet text-xs"
            >
              Clear filters
            </button>
          )}
        </div>

        <table className="table-base">
          <thead>
            <tr>
              <th>First seen</th>
              <th>Level</th>
              <th>Category</th>
              <th>What happened</th>
              <th className="text-right">Seen</th>
            </tr>
          </thead>
          <tbody>
            {feed.data?.items.map((e) => (
              <tr
                key={e.id}
                onClick={() => setOpen(e)}
                className="cursor-pointer hover:bg-[#FAFAF9]"
              >
                {/* First seen, which is also what the feed is ordered by. Showing last-seen
                    here instead would let a folded row display a time newer than the row
                    above it; the detail view carries both. */}
                <td className="whitespace-nowrap text-xs text-[#6B6661]">
                  {dateTime(e.createdAt)}
                </td>
                <td>
                  <span className={chipFor(e.level)}>{e.level}</span>
                </td>
                <td className="font-mono text-xs">{e.category}</td>
                <td className="max-w-xl truncate">{e.message}</td>
                <td className="text-right font-mono text-xs">
                  {/* A count above one is the same fault folded, within the hour it happened. */}
                  {e.count > 1 ? `${e.count}×` : ""}
                </td>
              </tr>
            ))}
            {feed.data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="table-empty">
                  Nothing recorded in this window. On a quiet system that is the right answer.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {open && (
        <div
          onClick={() => setOpen(null)}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6"
        >
          <div
            onClick={(ev) => ev.stopPropagation()}
            className="panel w-full max-w-3xl p-6"
            role="dialog"
            aria-label="System event detail"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className={chipFor(open.level)}>{open.level}</span>
                <h2 className="section-title mt-2">{open.message}</h2>
                <p className="mt-1 font-mono text-xs text-[#6B6661]">{open.category}</p>
              </div>
              <button onClick={() => setOpen(null)} className="link-quiet text-xs">
                Close
              </button>
            </div>

            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="label-mini">First seen</dt>
                <dd>{dateTime(open.createdAt)}</dd>
              </div>
              <div>
                <dt className="label-mini">Last seen</dt>
                <dd>
                  {dateTime(open.lastSeenAt)}
                  {open.count > 1 ? ` · ${open.count} occurrences` : ""}
                </dd>
              </div>
              {open.requestId && (
                <div>
                  <dt className="label-mini">Request</dt>
                  {/* The same id the API returns on every error, so a customer's screenshot
                      of a failure leads straight to the row that explains it. */}
                  <dd className="font-mono text-xs">{open.requestId}</dd>
                </div>
              )}
              {open.accountId && (
                <div>
                  <dt className="label-mini">Account</dt>
                  <dd>
                    <a
                      href={`/admin/accounts/${open.accountId}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {open.accountId.slice(0, 8)}
                    </a>
                  </dd>
                </div>
              )}
            </dl>

            {open.context !== null && open.context !== undefined && (
              <div className="mt-4">
                <p className="label-mini">Context</p>
                <pre className="mt-1 max-h-96 overflow-auto rounded-xl bg-[#FAFAF9] p-3 text-xs">
                  {JSON.stringify(open.context, null, 2)}
                </pre>
                <p className="mt-2 text-xs text-muted">
                  Anything that looked like a credential was replaced with <code>[redacted]</code>{" "}
                  before this was stored.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
