"use client";

import Link from "next/link";
import { use, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WaybillDocument as Waybill } from "@delicate/contracts";
import { api } from "@/lib/api";
import { WaybillDocument } from "@/components/shipments/waybill-document";

/**
 * The same printable waybill the customer gets, reached from the console.
 *
 * The print dialog opens by itself for the same reason it does in the portal: nobody lands
 * here by accident, and finding Ctrl-P is a step with no decision in it.
 */
export default function AdminWaybillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const doc = useQuery({
    queryKey: ["admin", "shipment", id, "waybill"],
    queryFn: () => api<Waybill>(`/v1/admin/shipments/${id}/waybill`),
  });

  useEffect(() => {
    if (!doc.data) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [doc.data]);

  if (doc.isLoading) return <p className="lede">Preparing the waybill…</p>;
  if (doc.error) return <p className="alert-error">{(doc.error as Error).message}</p>;
  if (!doc.data) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/shipments/${id}`} className="link-quiet text-xs">
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
