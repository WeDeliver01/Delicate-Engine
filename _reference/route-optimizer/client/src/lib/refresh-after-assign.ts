import type { QueryClient } from "@tanstack/react-query";

const KEYS_TO_INVALIDATE: (string | (string | number)[])[] = [
  "/api/dispatch/driver-locations",
  "/api/dispatch/all-shipments",
  "/api/projects",
  "/api/archives",
  "/api/audit",
  "/api/imports",
  "/api/notifications",
  "/api/shipment-alerts",
];

export function refreshAfterAssign(qc: QueryClient) {
  for (const key of KEYS_TO_INVALIDATE) {
    qc.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] });
  }
  qc.invalidateQueries({ predicate: (q) => {
    const k = q.queryKey?.[0];
    return typeof k === "string" && k.startsWith("/api/drivers");
  }});
}
