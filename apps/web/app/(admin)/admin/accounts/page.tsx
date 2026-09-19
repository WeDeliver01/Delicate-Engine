"use client";

import { DataTable } from "@/components/data-table";

export default function AdminAccounts() {
  return (
    <DataTable
      title="Accounts"
      path="/v1/admin/accounts"
      columns={[
        { key: "name", label: "Account" },
        { key: "organizationName", label: "Organization" },
        { key: "type", label: "Type" },
        { key: "billingMode", label: "Billing" },
        { key: "status", label: "Status" },
        { key: "createdAt", label: "Created" },
      ]}
    />
  );
}
