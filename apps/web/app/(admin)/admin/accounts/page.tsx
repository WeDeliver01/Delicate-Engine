"use client";

import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { useMe } from "@/components/use-me";
import { setActiveAccountId } from "@/lib/session";
import { rands } from "@/lib/money";

interface AccountRow {
  id?: string;
  name?: string;
  billingMode?: string;
  balanceCents?: number | null;
  creditLimitCents?: number | null;
}

/**
 * Every account, with the money in view and the two things ops actually do from here.
 *
 * The balance is a column rather than something you open each account to read: "who is out of
 * money" is the question this page gets asked, and answering it should not take twenty clicks.
 */
export default function AdminAccounts() {
  const me = useMe();
  const isSuperAdmin = me.data?.user.platformRole === "super_admin";

  /** Step into an account, optionally straight at the booking form. */
  const actAs = (id: string, to: string) => {
    setActiveAccountId(id);
    // A full load, not a client navigation: everything cached was fetched as the console, and
    // the portal has to come up as this account.
    window.location.assign(to);
  };

  return (
    <DataTable
      title="Accounts"
      path="/v1/admin/accounts"
      columns={[
        {
          key: "name",
          label: "Account",
          render: (r: AccountRow) => (
            <Link href={`/admin/accounts/${r.id}`} className="font-medium hover:underline">
              {r.name}
            </Link>
          ),
        },
        { key: "organizationName", label: "Organization" },
        { key: "type", label: "Type" },
        {
          key: "billingMode",
          label: "Billing",
          render: (r: AccountRow) => (
            <span className={`chip ${r.billingMode === "postpaid" ? "chip-info" : "chip-neutral"}`}>
              {r.billingMode === "postpaid" ? "Postpaid" : "Prepaid"}
            </span>
          ),
        },
        {
          key: "balanceCents",
          label: "Balance",
          render: (r: AccountRow) => {
            const balance = r.balanceCents ?? 0;
            const limit = r.creditLimitCents ?? 0;
            return (
              <span>
                {/* Negative is the number that needs noticing, so it is the one with colour. */}
                <span className={`figure ${balance < 0 ? "text-[#C13B73]" : ""}`}>
                  {rands(balance)}
                </span>
                {limit > 0 && (
                  <span className="block text-xs text-muted">on {rands(limit)} credit</span>
                )}
              </span>
            );
          },
        },
        { key: "status", label: "Status" },
      ]}
      actions={(r: AccountRow) =>
        isSuperAdmin && r.id ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => actAs(r.id!, "/portal/book")}
              className="link-accent text-xs"
              title="Open the booking form as this account, charged to their wallet"
            >
              Book for
            </button>
            <button
              type="button"
              onClick={() => actAs(r.id!, "/portal")}
              className="link-quiet text-xs"
              title="Open the portal as this account"
            >
              Act as
            </button>
          </div>
        ) : null
      }
    />
  );
}
