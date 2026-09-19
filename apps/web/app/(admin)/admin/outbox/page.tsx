"use client";

import { useState } from "react";
import { DataTable } from "@/components/data-table";
import { api } from "@/lib/api";

const STATUSES = ["", "pending", "processing", "delivered", "failed", "dead"];

interface OutboxRow {
  id: string;
  eventType: string;
  dedupeKey: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
}

export default function AdminOutbox() {
  const [status, setStatus] = useState("");
  return (
    <div className="space-y-4">
      <label className="text-sm">
        Status{" "}
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded border px-2 py-1"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s || "all"}
            </option>
          ))}
        </select>
      </label>
      <DataTable<OutboxRow>
        title="Outbox"
        path={`/v1/admin/outbox${status ? `?status=${status}` : ""}`}
        columns={[
          { key: "createdAt", label: "Created" },
          { key: "eventType", label: "Event" },
          { key: "dedupeKey", label: "Dedupe key" },
          { key: "status", label: "Status" },
          { key: "attempts", label: "Attempts" },
          {
            key: "lastError",
            label: "Last error",
            render: (r) => <span className="text-xs text-red-700">{r.lastError ?? "—"}</span>,
          },
        ]}
        actions={(row, refetch) =>
          row.status === "dead" || row.status === "failed" ? (
            <button
              onClick={async () => {
                await api(`/v1/admin/outbox/${row.id}/requeue`, { method: "POST" });
                refetch();
              }}
              className="rounded border px-2 py-1 text-xs"
            >
              Requeue
            </button>
          ) : null
        }
      />
    </div>
  );
}
