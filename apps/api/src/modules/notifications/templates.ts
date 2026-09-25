import type {
  NotificationAudience,
  NotificationChannel,
  NotificationKind,
} from "@delicate/contracts";

/**
 * The messages the business sends, as shipped. Seeded into `notification_templates` on first
 * boot and owned by the operator from then on — editing the copy in the console never has to
 * touch code, and a redeploy never overwrites their words.
 *
 * Placeholders are `{{ field }}`, filled from the notification's payload. An unknown field
 * renders as an empty string rather than the literal braces, because a customer should never
 * receive `{{ recipientName }}`.
 */
export interface TemplateSeed {
  kind: NotificationKind;
  channel: NotificationChannel;
  audience: NotificationAudience;
  subject: string | null;
  body: string;
}

export const TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    kind: "booking.confirmed",
    channel: "email",
    audience: "customer",
    subject: "Booking {{reference}} confirmed",
    body: `Hi {{customerName}},

Your booking {{reference}} is confirmed — {{dropCount}} delivery for {{slot}}.

{{waybills}}

Total: {{total}} (incl. VAT), held against your wallet and charged as each drop is completed.

Track it any time at {{trackUrl}}.

— {{companyName}}`,
  },
  {
    kind: "booking.rejected",
    channel: "email",
    audience: "customer",
    subject: "We could not confirm your booking",
    body: `Hi {{customerName}},

We could not confirm your booking: {{reason}}

Nothing has been charged. {{nextStep}}

— {{companyName}}`,
  },
  {
    kind: "shipment.collected",
    channel: "email",
    audience: "customer",
    subject: "{{waybill}} collected",
    body: `Hi {{customerName}},

{{driverName}} has collected {{waybill}} and is on the way to {{destination}}.

Track it at {{trackUrl}}.

— {{companyName}}`,
  },
  {
    kind: "shipment.out_for_delivery",
    channel: "sms",
    audience: "recipient",
    subject: null,
    body: `Hi {{recipientName}}, your delivery from {{customerName}} is on the way with {{driverName}}. Track: {{trackUrl}}`,
  },
  {
    kind: "shipment.delivered",
    channel: "email",
    audience: "customer",
    subject: "{{waybill}} delivered",
    body: `Hi {{customerName}},

{{waybill}} was delivered to {{destination}} at {{deliveredAt}} and signed for by {{receivedBy}}.

Proof of delivery is on your booking at {{trackUrl}}.

— {{companyName}}`,
  },
  {
    kind: "shipment.delivered",
    channel: "sms",
    audience: "recipient",
    subject: null,
    body: `Your delivery from {{customerName}} has arrived. Thank you! — {{companyName}}`,
  },
  {
    kind: "shipment.failed",
    channel: "email",
    audience: "customer",
    subject: "We could not deliver {{waybill}}",
    body: `Hi {{customerName}},

We could not deliver {{waybill}} to {{destination}}: {{reason}}

{{nextStep}}

— {{companyName}}`,
  },
  {
    kind: "wallet.topped_up",
    channel: "email",
    audience: "customer",
    subject: "{{amount}} added to your wallet",
    body: `Hi {{customerName}},

{{amount}} has been added to your wallet. Your balance is now {{balance}}.

— {{companyName}}`,
  },
  {
    kind: "wallet.low_balance",
    channel: "email",
    audience: "customer",
    subject: "Your wallet is running low",
    body: `Hi {{customerName}},

Your wallet balance is {{balance}}, which may not cover your next booking.

Top up at {{portalUrl}} to avoid a booking being held up.

— {{companyName}}`,
  },
  {
    kind: "invoice.issued",
    channel: "email",
    audience: "customer",
    subject: "{{documentTitle}} {{number}}",
    body: `Hi {{customerName}},

{{documentTitle}} {{number}} for {{total}} is ready.

{{dueLine}}

You can see it at {{portalUrl}}.

— {{companyName}}`,
  },
  {
    kind: "invoice.overdue",
    channel: "email",
    audience: "customer",
    subject: "{{number}} is overdue",
    body: `Hi {{customerName}},

Invoice {{number}} for {{outstanding}} was due on {{dueDate}} and is still outstanding.

{{bankLine}}

If you have already paid, please ignore this and send us the reference.

— {{companyName}}`,
  },
];

/**
 * Fill `{{ field }}` placeholders. Unknown fields render empty: a customer should never receive
 * a message with the braces still in it.
 */
export function render(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = payload[key];
    return value === undefined || value === null ? "" : String(value);
  });
}
