"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { HealthResponse, SystemEventStats } from "@delicate/contracts";
import { api } from "@/lib/api";

export default function AdminOverview() {
  const health = useQuery({
    queryKey: ["healthz"],
    queryFn: () => api<HealthResponse>("/healthz"),
    refetchInterval: 15_000,
  });
  const outbox = useQuery({
    queryKey: ["admin", "outbox", "stats"],
    queryFn: () => api<Record<string, number>>("/v1/admin/outbox/stats"),
    refetchInterval: 5_000,
  });
  const events = useQuery({
    queryKey: ["admin", "system-events", "stats", "overview"],
    queryFn: () => api<SystemEventStats>("/v1/admin/system-events/stats?hours=24"),
    refetchInterval: 60_000,
  });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card title="Engine">
        <Row k="Status" v={health.data?.status ?? "…"} />
        <Row k="Version" v={health.data?.version ?? "…"} />
        <Row
          k="Database"
          v={
            health.data
              ? `${health.data.checks["database"]?.status} (${health.data.checks["database"]?.latencyMs ?? "?"} ms)`
              : "…"
          }
        />
        <Row
          k="Uptime"
          v={health.data ? `${Math.round(health.data.uptimeSeconds / 60)} min` : "…"}
        />
      </Card>
      <Card title="Outbox">
        {outbox.error ? (
          <p className="text-sm text-muted">Super admin only.</p>
        ) : (
          ["pending", "processing", "delivered", "failed", "dead"].map((s) => (
            <Row key={s} k={s} v={String(outbox.data?.[s] ?? 0)} />
          ))
        )}
      </Card>
      {/* This card is where Phase 8 started: the Overview already showed the outbox counts, so
          it was the page that made the absence of "what went wrong" obvious. */}
      <Card title="What went wrong, last 24h">
        {events.error ? (
          <p className="text-sm text-muted">Super admin only.</p>
        ) : (
          <>
            <Row k="Errors" v={String(events.data?.errors ?? 0)} />
            <Row k="Warnings" v={String(events.data?.warnings ?? 0)} />
            {/* The top category, because "12 errors" is a number and "12 errors, all
                webhook.bobpay" is the beginning of a diagnosis. */}
            {events.data?.categories[0] && (
              <Row
                k="Most of them"
                v={`${events.data.categories[0].category} (${events.data.categories[0].count})`}
              />
            )}
            <Link href="/admin/system-events" className="link-quiet mt-2 block text-xs">
              Open the feed
            </Link>
          </>
        )}
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-6">
      <h2 className="section-title">{title}</h2>
      <dl className="mt-3 text-sm">{children}</dl>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-1">
      <dt className="capitalize text-muted">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
