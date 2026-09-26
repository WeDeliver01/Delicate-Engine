"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CHANGE_REQUEST_KIND_LABELS,
  type ChangeRequest,
  type ChangeRequestStatus,
} from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";

/**
 * The queue of changes customers have asked for and the engine would not apply on its own.
 *
 * Shown as before → after rather than as a form, because the decision is "is this all right",
 * not "what should this be". The note is required on a refusal and optional on an approval:
 * a customer told no deserves a reason, and one told yes does not need one.
 */
export default function ChangeQueuePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<ChangeRequestStatus>("pending");
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ["admin", "changes", tab],
    queryFn: () => api<{ items: ChangeRequest[] }>(`/v1/admin/changes?status=${tab}`),
    refetchInterval: tab === "pending" ? 30_000 : false,
  });

  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "approve" | "reject"; note?: string }) =>
      api(`/v1/admin/changes/${v.id}/decide`, {
        method: "POST",
        json: { decision: v.decision, note: v.note },
      }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["admin", "changes"] });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : String(e)),
  });

  const tabs: ChangeRequestStatus[] = ["pending", "approved", "rejected", "withdrawn"];

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Operations</p>
        <h1 className="page-title mt-1">Change requests</h1>
        <p className="lede mt-1">
          Address changes and new dates wait here. Contact details and instructions apply themselves
          and only appear in a shipment&apos;s history.
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`chip capitalize transition-colors ${
              tab === t ? "bg-ink text-white" : "chip-outline hover:border-ink hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <p className="alert-error">{error}</p>}

      {queue.isLoading ? (
        <div className="panel">
          <p className="table-empty">Loading…</p>
        </div>
      ) : !queue.data?.items.length ? (
        <div className="panel">
          <p className="table-empty">
            {tab === "pending" ? "Nothing is waiting. " : "Nothing here. "}
            {tab === "pending" && "Every request has been dealt with."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {queue.data.items.map((c) => (
            <li key={c.id} className="panel">
              <div className="panel-head">
                <div>
                  <span className="chip chip-info">{CHANGE_REQUEST_KIND_LABELS[c.kind]}</span>
                  <Link
                    href={`/admin/shipments?search=${c.waybill ?? ""}`}
                    className="ml-2 font-mono text-sm hover:underline"
                  >
                    {c.waybill}
                  </Link>
                </div>
                <span className="text-xs text-muted">
                  asked {new Date(c.createdAt).toLocaleString("en-ZA")}
                </span>
              </div>

              <div className="panel-body space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <ValueBox label="Now" value={c.previous} tone="was" />
                  <ValueBox label="Wants" value={c.requested} tone="wants" />
                </div>

                {c.reason && (
                  <p className="text-sm">
                    <span className="label-mini">Their reason</span>
                    <br />
                    {c.reason}
                  </p>
                )}
                {c.heldBecause && (
                  <p className="text-xs text-muted">Held because {c.heldBecause}.</p>
                )}

                {c.status === "pending" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={note[c.id] ?? ""}
                      onChange={(e) => setNote({ ...note, [c.id]: e.target.value })}
                      placeholder="Note to the customer (required to decline)"
                      className="input min-w-52 flex-1"
                    />
                    <button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ id: c.id, decision: "approve", note: note[c.id] })
                      }
                      className="btn btn-primary btn-sm"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={decide.isPending || !note[c.id]?.trim()}
                      title={!note[c.id]?.trim() ? "Say why, so we can tell them" : undefined}
                      onClick={() =>
                        decide.mutate({ id: c.id, decision: "reject", note: note[c.id] })
                      }
                      className="btn btn-danger btn-sm"
                    >
                      Decline
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-muted">
                    {c.status}{" "}
                    {c.decidedAt && `on ${new Date(c.decidedAt).toLocaleString("en-ZA")}`}
                    {c.decisionNote && ` · ${c.decisionNote}`}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Renders whichever shape the change happens to carry. The payloads differ per kind and are
 * stored loosely on purpose, so this formats what it finds rather than switching on the kind
 * and needing an edit every time a kind is added.
 */
function ValueBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: Record<string, unknown>;
  tone: "was" | "wants";
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        tone === "wants" ? "border-[#F3C6D9] bg-[#FCEEF4]" : "border-line bg-[#FAFAF9]"
      }`}
    >
      <p className="label-mini">{label}</p>
      <div className="mt-1 space-y-0.5 text-sm">
        {Object.entries(value)
          .filter(([k]) => k !== "kind")
          .map(([k, v]) => (
            <p key={k}>
              <span className="text-muted">{humanise(k)}: </span>
              {format(v)}
            </p>
          ))}
      </div>
    </div>
  );
}

function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function format(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Addresses and contacts both have an obvious one-line form; anything else falls back to
    // its own JSON rather than rendering "[object Object]".
    if (typeof o.formatted === "string") return o.formatted;
    if (typeof o.name === "string") {
      return [o.name, o.phone, o.email].filter(Boolean).join(" · ");
    }
    return JSON.stringify(v);
  }
  return String(v);
}
