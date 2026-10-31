"use client";

import { useQuery } from "@tanstack/react-query";
import type { Account } from "@delicate/contracts";
import { api } from "@/lib/api";
import { CopyField, Panel } from "@/components/ui";

/**
 * What a customer gives their developer so their own shop can book with us.
 *
 * It exists because the alternative was an email thread. Someone connecting a WooCommerce or
 * Shopify store needs one value from us, and they were getting it by asking — which meant
 * waiting, and meant a uuid read over the phone at least once.
 */
export default function PortalIntegration() {
  const account = useQuery({
    queryKey: ["account", "detail"],
    queryFn: () => api<Account>("/v1/account"),
  });

  if (!account.data) return <p className="p-10 text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">Integration</h1>
        <p className="mt-1 text-sm text-muted">
          Connecting your own shop to us — what to put in its settings, and who to ask when it does
          not work.
        </p>
      </header>

      <Panel title="Your account reference" description="The one value your store needs from us.">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <CopyField
            label="Account reference"
            value={account.data.code}
            hint="Goes in your store's Delicate Courier delivery settings."
          />
          <CopyField
            label="Account ID"
            value={account.data.id}
            hint="Only useful if support asks for it."
          />
        </div>
        <div className="panel-note">
          Your reference never changes, so it is safe to write into a config file. Treat it as an
          address rather than a password: knowing it does not let anyone book on your account, and
          nothing is lost if it appears in a support ticket.
        </div>
      </Panel>

      <Panel title="Before it will book">
        <div className="space-y-3 p-5 text-sm text-ink">
          <p>
            Your shop also needs permission to book against this account, which we switch on at our
            end. If your store is set up correctly and still gets turned away, that is almost always
            the missing piece — tell us and we will check it.
          </p>
          <p className="text-muted">
            Deliveries booked by your shop are paid for the same way as the ones you book here, from
            this account&rsquo;s wallet, and show up in the same place.
          </p>
        </div>
      </Panel>
    </div>
  );
}
