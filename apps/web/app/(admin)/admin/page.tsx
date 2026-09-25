"use client";

import { useQuery } from "@tanstack/react-query";
import type { HealthResponse } from "@delicate/contracts";
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
