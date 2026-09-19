"use client";

import { DataTable } from "@/components/data-table";

export default function AdminAudit() {
  return (
    <DataTable
      title="Audit log"
      path="/v1/admin/audit"
      columns={[
        { key: "createdAt", label: "When" },
        { key: "action", label: "Action" },
        { key: "entityType", label: "Entity" },
        { key: "entityId", label: "Id" },
        { key: "actorUserId", label: "Actor" },
        { key: "requestId", label: "Request" },
      ]}
    />
  );
}
