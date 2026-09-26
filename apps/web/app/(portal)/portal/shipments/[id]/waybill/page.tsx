"use client";

import Link from "next/link";
import { use, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WaybillDocument as Waybill } from "@delicate/contracts";
import { api } from "@/lib/api";
import { WaybillDocument } from "@/components/shipments/waybill-document";

/**
 * A waybill on its own page so it prints as one sheet with nothing else on it.
 *
 * The print dialog opens by itself, because this page is only ever reached by someone who
 * clicked "Waybill" — making them then find Ctrl-P is a step with no decision in it.
 */
export default function WaybillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const doc = useQuery({
    queryKey: ["shipment", id, "waybill"],
    queryFn: () => api<Waybill>(`/v1/account/shipments/${id}/waybill`),
  });

  useEffect(() => {
    if (!doc.data) return;
    // One frame, so the browser has laid the document out before it is captured.
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [doc.data]);

  if (doc.isLoading) return <p className="lede">Preparing the waybill…</p>;
  if (doc.error) return <p className="alert-error">{(doc.error as Error).message}</p>;
  if (!doc.data) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/portal/shipments/${id}`} className="link-quiet text-xs">
          ← Back to the shipment
        </Link>
        <button type="button" onClick={() => window.print()} className="btn btn-primary btn-sm">
          Print or save as PDF
        </button>
      </div>
      <WaybillDocument doc={doc.data} />
    </div>
  );
}
