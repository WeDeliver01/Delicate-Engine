"use client";

import Link from "next/link";
import { DataTable } from "@/components/data-table";

export default function AdminAccounts() {
  return (
    <DataTable
      title="Accounts"
      path="/v1/admin/accounts"
      columns={[
        {
          key: "name",
          label: "Account",
          render: (r: { id?: string; name?: string }) => (
            <Link href={`/admin/accounts/${r.id}`} className="font-medium hover:underline">
              {r.name}
            </Link>
          ),
        },
        { key: "organizationName", label: "Organization" },
        { key: "type", label: "Type" },
        { key: "billingMode", label: "Billing" },
        { key: "status", label: "Status" },
        { key: "createdAt", label: "Created" },
      ]}
    />
  );
}
