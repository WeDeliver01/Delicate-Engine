"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImportAddressesResult, SavedAddress } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";

/** The places a customer sends to, and a way to bring an existing list in one file. */
export default function PortalAddresses() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["portal", "address-book"] });

  const list = useQuery({
    queryKey: ["portal", "address-book", search],
    queryFn: () =>
      api<SavedAddress[]>(
        `/v1/account/address-book${search ? `?search=${encodeURIComponent(search)}` : ""}`,
      ),
  });
  const archive = useMutation({
    mutationFn: (id: string) => api(`/v1/account/address-book/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Address book</h1>
          <p className="mt-1 text-sm text-[#6B6661]">
            The places you send to. Saved addresses are offered when you book, most-used first.
          </p>
        </div>
        <button onClick={() => setImporting(!importing)} className="btn btn-primary">
          {importing ? "Close" : "Import a list"}
        </button>
      </header>

      {error && <p className="alert-error">{error}</p>}

      {importing && <Importer onDone={invalidate} onError={onError} />}

      <div className="flex items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, label or street"
          className="flex-1 input text-sm"
        />
        <a
          href="/api/v1/account/address-book/export.csv"
          className="whitespace-nowrap text-sm text-muted hover:underline"
        >
          Export CSV
        </a>
      </div>

      <ul className="space-y-2">
        {list.data?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-start gap-3 panel p-4 text-sm">
            <div className="min-w-48 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.label}</span>
                {a.isDefault && <span className="chip chip-bad">default</span>}
                {a.isCollectionPoint && <span className="chip chip-neutral">collection point</span>}
                {a.address.location.lat === 0 && a.address.location.lng === 0 && (
                  <span className="chip chip-warn">needs a map pin</span>
                )}
              </div>
              <div className="text-[#6B6661]">{a.address.formatted}</div>
              <div className="text-xs text-muted">
                {a.contact.name} · {a.contact.phone}
                {a.contact.email ? ` · ${a.contact.email}` : ""}
              </div>
              {a.instructions && <div className="mt-1 text-xs text-muted">“{a.instructions}”</div>}
            </div>
            <div className="text-right text-xs text-muted">
              {a.useCount > 0 ? `used ${a.useCount}×` : "not used yet"}
              <button
                onClick={() => archive.mutate(a.id)}
                className="mt-1 block text-muted hover:text-[#C13B73] hover:underline"
              >
                remove
              </button>
            </div>
          </li>
        ))}
        {list.data?.length === 0 && (
          <li className="panel p-8 text-center text-sm text-muted">
            No saved addresses yet. Import your list, or save one while booking.
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * Import is two steps on purpose: check, then commit. The customer sees exactly what will
 * happen to every row before a single one is written.
 */
function Importer({ onDone, onError }: { onDone: () => void; onError: (e: unknown) => void }) {
  const [csv, setCsv] = useState("");
  const [updateExisting, setUpdateExisting] = useState(false);
  const [result, setResult] = useState<ImportAddressesResult | null>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      api<ImportAddressesResult>("/v1/account/address-book/import", {
        method: "POST",
        json: { csv, dryRun, updateExisting },
      }),
    onSuccess: (r) => {
      setResult(r);
      if (!r.dryRun) onDone();
    },
    onError,
  });

  const onFile = async (file: File) => {
    setCsv(await file.text());
    setResult(null);
  };

  return (
    <section className="space-y-4 panel p-6 text-sm">
      <div>
        <h2 className="section-title">Import from a spreadsheet</h2>
        <p className="mt-1 text-[#6B6661]">
          Save your list as CSV. It needs a <span className="font-mono">label</span> and{" "}
          <span className="font-mono">address</span> column;{" "}
          <span className="font-mono">contact_name</span>,{" "}
          <span className="font-mono">contact_phone</span>,{" "}
          <span className="font-mono">contact_email</span>,{" "}
          <span className="font-mono">suburb</span>, <span className="font-mono">city</span>,{" "}
          <span className="font-mono">postal_code</span> and{" "}
          <span className="font-mono">instructions</span> are used if present.{" "}
          <a href="/api/v1/account/address-book/template.csv" className="underline">
            Download a template
          </a>
          .
        </p>
      </div>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
        className="block w-full text-sm"
      />
      <textarea
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setResult(null);
        }}
        rows={6}
        placeholder="…or paste the CSV here"
        className="w-full input font-mono text-xs"
      />

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={updateExisting}
          onChange={(e) => setUpdateExisting(e.target.checked)}
          className="h-4 w-4"
        />
        Update entries I already have with the same label
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => run.mutate(true)}
          disabled={csv.trim().length === 0 || run.isPending}
          className="btn btn-secondary"
        >
          {run.isPending ? "Checking…" : "Check the file"}
        </button>
        {result?.dryRun && result.total > result.errors && (
          <button
            onClick={() => run.mutate(false)}
            disabled={run.isPending}
            className="rounded-full bg-ink px-5 py-2 text-white hover:bg-brand-pink disabled:opacity-40"
          >
            Import {result.created + result.updated} address
            {result.created + result.updated === 1 ? "" : "es"}
          </button>
        )}
      </div>

      {result && (
        <div className="rounded-xl bg-[#FAFAF9] p-4">
          <p className="font-medium">
            {result.dryRun ? "Nothing written yet." : "Imported."} {result.created} to add,{" "}
            {result.updated} to update, {result.skipped} skipped, {result.errors} with problems.
          </p>
          {result.rows.some((r) => r.outcome !== "create") && (
            <table className="mt-3 w-full text-left text-xs">
              <thead className="uppercase text-muted">
                <tr>
                  <th className="py-1">Line</th>
                  <th className="py-1">Label</th>
                  <th className="py-1">What happens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EDE9]">
                {result.rows
                  .filter((r) => r.outcome !== "create" || r.needsLocation)
                  .map((r) => (
                    <tr key={r.line}>
                      <td className="py-1 font-mono">{r.line}</td>
                      <td className="py-1">{r.label || "—"}</td>
                      <td
                        className={`py-1 ${r.outcome === "error" ? "text-[#C13B73]" : "text-[#6B6661]"}`}
                      >
                        {r.message ?? r.outcome}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
