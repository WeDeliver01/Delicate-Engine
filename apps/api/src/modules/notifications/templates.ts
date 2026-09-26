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
    kind: "account.created",
    channel: "email",
    audience: "customer",
    subject: "Welcome to {{companyName}}",
    body: `Hi {{customerName}},

Your account {{accountName}} is open and ready to book.

Deliveries are paid from your wallet: top it up, book, and the amount is held until the parcel
is delivered. Nothing is charged for a booking you cancel before collection.

Book your first delivery at {{portalUrl}}.

— {{companyName}}`,
  },
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
  {
    kind: "shipment.assigned",
    channel: "email",
    audience: "customer",
    subject: "{{waybill}} is scheduled with a driver",
    body: `Hi {{customerName}},

{{waybill}} is assigned to {{driverName}} for {{slot}}.

We will message {{recipientName}} when the driver sets off.

Track it at {{trackUrl}}.

— {{companyName}}`,
  },
  {
    kind: "booking.cancelled",
    channel: "email",
    audience: "customer",
    subject: "Booking {{reference}} cancelled",
    body: `Hi {{customerName}},

Booking {{reference}} has been cancelled{{reason}}.

Anything held against your wallet for it has been released and is available to spend again.

— {{companyName}}`,
  },
  {
    kind: "shipment.change_applied",
    channel: "email",
    audience: "customer",
    subject: "{{waybill}} updated",
    body: `Hi {{customerName}},

We have updated the {{changeKind}} on {{waybill}}. The driver sees the new details.

If this was not you, reply to this email straight away.

— {{companyName}}`,
  },
  {
    kind: "shipment.change_requested",
    channel: "email",
    audience: "customer",
    subject: "We are checking your change to {{waybill}}",
    body: `Hi {{customerName}},

You asked us to change the {{changeKind}} on {{waybill}}. Our team is checking it, because
{{heldBecause}}.

We will email you as soon as it is confirmed. Until then the delivery is unchanged.

— {{companyName}}`,
  },
  {
    kind: "shipment.change_approved",
    channel: "email",
    audience: "customer",
    subject: "Your change to {{waybill}} is confirmed",
    body: `Hi {{customerName}},

The {{changeKind}} on {{waybill}} has been updated as you asked.{{note}}

See the delivery at {{trackUrl}}.

— {{companyName}}`,
  },
  {
    kind: "shipment.change_rejected",
    channel: "email",
    audience: "customer",
    subject: "We could not change {{waybill}}",
    body: `Hi {{customerName}},

We were not able to change the {{changeKind}} on {{waybill}}.{{note}}

The delivery goes ahead as originally booked. Call us if you would like to talk it through.

— {{companyName}}`,
  },
  {
    /**
     * WhatsApp to the person waiting at the door. Nothing sends until a provider is connected
     * and this exact wording has been approved by Meta, so the copy is written to pass that
     * review: a utility message about a delivery the recipient is expecting, and no marketing.
     */
    kind: "shipment.out_for_delivery",
    channel: "whatsapp",
    audience: "recipient",
    subject: null,
    body: `Hi {{recipientName}}, your delivery from {{customerName}} is on the way with {{driverName}} and should reach you {{eta}}.

Please let us know if someone can receive it, or reply here to make other arrangements.

Track it: {{trackUrl}}
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
