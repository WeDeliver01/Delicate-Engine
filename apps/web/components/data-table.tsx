"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Minimal cursor-paginated table over any `{ items, nextCursor }` endpoint. Enough for the
 * Phase 0 console; a proper design system replaces it later.
 */
export function DataTable<T extends { id?: string }>(props: {
  title: string;
  path: string;
  columns: { key: string; label: string; render?: (row: T) => React.ReactNode }[];
  actions?: (row: T, refetch: () => void) => React.ReactNode;
}) {
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const sep = props.path.includes("?") ? "&" : "?";
  const query = useQuery({
    queryKey: ["table", props.path, cursor ?? null],
    queryFn: () =>
      api<Page<T>>(`${props.path}${cursor ? `${sep}cursor=${encodeURIComponent(cursor)}` : ""}`),
  });

  return (
    <section className="rounded-lg border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h1 className="font-semibold">{props.title}</h1>
        <div className="flex gap-2 text-sm">
          <button
            disabled={cursors.length === 0}
            onClick={() => setCursors((c) => c.slice(0, -1))}
            className="rounded border px-2 py-1 disabled:opacity-40"
          >
            ← Prev
          </button>
          <button
            disabled={!query.data?.nextCursor}
            onClick={() => setCursors((c) => [...c, query.data!.nextCursor!])}
            className="rounded border px-2 py-1 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>
      {query.error ? (
        <p className="p-4 text-sm text-[#C13B73]">{String(query.error)}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr>
              {props.columns.map((c) => (
                <th key={c.key} className="px-4 py-2">
                  {c.label}
                </th>
              ))}
              {props.actions && <th />}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EDE9]">
            {query.data?.items.map((row, i) => (
              <tr key={row.id ?? i}>
                {props.columns.map((c) => (
                  <td key={c.key} className="px-4 py-2 align-top">
                    {c.render ? c.render(row) : formatCell((row as Record<string, unknown>)[c.key])}
                  </td>
                ))}
                {props.actions && (
                  <td className="px-4 py-2 text-right">
                    {props.actions(row, () => void query.refetch())}
                  </td>
                )}
              </tr>
            ))}
            {query.data?.items.length === 0 && (
              <tr>
                <td colSpan={props.columns.length + 1} className="px-4 py-6 text-center text-muted">
                  Nothing here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v))
    return new Date(v).toLocaleString("en-ZA");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
