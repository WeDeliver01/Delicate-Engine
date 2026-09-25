"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dateTime, rands } from "@/lib/money";
import { PageHeader, Panel } from "@/components/ui";

interface CheckResult {
  key: string;
  title: string;
  why: string;
  ok: boolean;
  differenceCents: number;
  detail: string;
  offenders: { id: string; label: string; expectedCents: number; actualCents: number }[];
}
interface Report {
  ranAt: string;
  ok: boolean;
  checks: CheckResult[];
}

/**
 * Proof, rather than assurance. Each row checks one promise the engine makes against the data
 * itself — never against the code that wrote it — and says what would be wrong in the world if
 * it failed.
 */
export default function AdminReconciliation() {
  const r = useQuery({
    queryKey: ["admin", "reconciliation"],
    queryFn: () => api<Report>("/v1/admin/analytics/reconciliation"),
    refetchInterval: 60_000,
  });

  const d = r.data;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Reconciliation"
        lede="Every invariant this engine claims, checked against the data. It repairs nothing on purpose — a drift is a bug with a cause, and a report that quietly fixed it would hide the thing worth knowing."
        actions={
          <button onClick={() => void r.refetch()} className="btn btn-secondary btn-sm">
            {r.isFetching ? "Checking…" : "Run again"}
          </button>
        }
      />

      {d && (
        <section
          className={`panel flex flex-wrap items-center justify-between gap-3 p-5 ${
            d.ok ? "" : "border-[#F3C6D9] bg-[#FCEEF4]"
          }`}
        >
          <div>
            <div
              className={`font-display text-xl font-bold ${d.ok ? "text-[#1B7F4B]" : "text-[#C13B73]"}`}
            >
              {d.ok
                ? "Everything reconciles"
                : `${d.checks.filter((c) => !c.ok).length} check(s) failing`}
            </div>
            <div className="text-xs text-muted">Checked {dateTime(d.ranAt)}</div>
          </div>
          <span className={d.ok ? "chip chip-good" : "chip chip-bad"}>
            {d.checks.filter((c) => c.ok).length} of {d.checks.length} passing
          </span>
        </section>
      )}

      <div className="space-y-3">
        {d?.checks.map((c) => (
          <Panel key={c.key} className={c.ok ? "" : "border-[#F3C6D9]"}>
            <div className="panel-body">
              <div className="flex flex-wrap items-start gap-3">
                <span className={c.ok ? "chip chip-good" : "chip chip-bad"}>
                  {c.ok ? "passes" : "fails"}
                </span>
                <div className="min-w-48 flex-1">
                  <div className="font-medium">{c.title}</div>
                  <p className="mt-0.5 text-xs text-muted">{c.why}</p>
                </div>
                {c.differenceCents !== 0 && (
                  <span className="figure text-sm text-[#C13B73]">
                    out by {rands(c.differenceCents)}
                  </span>
                )}
              </div>
              <p className={`mt-2 text-sm ${c.ok ? "text-[#6B6661]" : "text-[#C13B73]"}`}>
                {c.detail}
              </p>

              {c.offenders.length > 0 && (
                <table className="mt-3 w-full text-left text-xs">
                  <thead className="label-mini">
                    <tr>
                      <th className="py-1">What</th>
                      <th className="py-1 text-right">Should be</th>
                      <th className="py-1 text-right">Is</th>
                      <th className="py-1 text-right">Out by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EDE9]">
                    {c.offenders.map((o) => (
                      <tr key={o.id}>
                        <td className="py-1">{o.label}</td>
                        <td className="figure py-1 text-right">{rands(o.expectedCents)}</td>
                        <td className="figure py-1 text-right">{rands(o.actualCents)}</td>
                        <td className="figure py-1 text-right text-[#C13B73]">
                          {rands(o.actualCents - o.expectedCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
