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
    body: `Your {{companyName}} account is now active and ready to use.

You can now book and manage your deliveries through your online account, with access to your
delivery history, tracking information and account details in one place.

**Ready to send your first delivery?**

Log in to your {{companyName}} account to create a booking and get your delivery underway.

We look forward to delivering with you.

The {{companyName}} Team

{{portalUrl}}`,
  },
  {
    kind: "booking.confirmed",
    channel: "email",
    audience: "customer",
    subject: "Booking {{reference}} confirmed",
    /*
      No waybill list in the words: the layout prints the parcels as a table underneath, and
      the same references twice is how a confirmation starts looking like a receipt printer.
    */
    body: `Hi {{customerName}},

Your booking {{reference}} is confirmed — {{dropCount}} for {{slot}}.

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
    body: `Hi {{recipientName}}, your delivery from {{customerName}} is on the way with {{driverName}}. Follow it: {{liveUrl}}`,
  },
  {
    kind: "shipment.on_hold",
    channel: "email",
    audience: "customer",
    subject: "{{waybill}} is on hold",
    body: `Hi {{customerName}},

{{waybill}} is on hold and is not moving at the moment.

{{reasonText}}

We will be in touch. You can see where it stands at any time at {{trackUrl}}.

— {{companyName}}`,
  },
  {
    kind: "shipment.returned_to_sender",
    channel: "email",
    audience: "customer",
    subject: "{{waybill}} has come back to you",
    body: `Hi {{customerName}},

We could not complete {{waybill}} and it is on its way back to you.

{{reasonText}}

Nothing further will happen to this waybill. If the parcel still needs to go out, book it again
and we will collect it.

— {{companyName}}`,
  },
  {
    kind: "shipment.driver_arriving",
    channel: "sms",
    audience: "recipient",
    subject: null,
    // `{{eta}}` carries "has arrived" or "is about 10 minutes away", so the gap the driver
    // chose is a value and not four near-identical templates to keep in step.
    //
    // No tracking link, on purpose. This is the one message that has to fit a single SMS
    // segment: it is sent when minutes matter, and the recipient already has the link from
    // the out-for-delivery message. The email twin below does carry it.
    body: `Hi {{recipientName}}, your driver {{driverName}} {{eta}} with your delivery from {{customerName}}.`,
  },
  {
    kind: "shipment.driver_arriving",
    channel: "email",
    audience: "recipient",
    subject: "Your delivery from {{customerName}}",
    body: `Hi {{recipientName}},

Your driver {{driverName}} {{eta}} with your delivery from {{customerName}}.

Follow the van: {{liveUrl}}

— {{companyName}}`,
  },
  {
    kind: "shipment.collection_arriving",
    channel: "sms",
    audience: "customer",
    subject: null,
    body: `Hi, this is {{driverName}} from {{companyName}}. I {{eta}} to collect {{waybill}}.`,
  },
  {
    kind: "shipment.collection_arriving",
    channel: "email",
    audience: "customer",
    subject: "Collecting {{waybill}}",
    body: `Hi {{customerName}},

{{driverName}} {{eta}} to collect {{waybill}}.

— {{companyName}}`,
  },
  {
    kind: "shipment.at_risk",
    channel: "email",
    audience: "customer",
    subject: "{{waybill}} may miss its window",
    body: `Hi {{customerName}},

{{waybill}} to {{recipientName}} was promised by {{windowEnd}} and is running late. We are on it, and you are hearing from us before the recipient calls you.

{{reasonText}}

Track it: {{trackUrl}}`,
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
    body: `Your delivery from {{customerName}} has arrived. Thank you! Delivery note: {{liveUrl}} — {{companyName}}`,
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

Follow it: {{liveUrl}}
— {{companyName}}`,
  },
  {
    /*
      A balance that moved without the customer doing anything. Nearly always us putting right
      something they told us about -- a refund, a goodwill credit, a correction -- and the one
      kind of money movement they cannot see coming, so it is the one that most needs saying.
    */
    kind: "wallet.adjusted",
    channel: "email",
    audience: "customer",
    subject: "{{direction}} of {{amount}} on your {{companyName}} wallet",
    body: `Hi {{customerName}},

We have {{verb}} {{amount}} {{preposition}} your wallet.

Reason: {{reason}}
New balance: {{balance}}

If this does not look right, reply to this email and we will sort it out.

See the full history at {{portalUrl}}.

— {{companyName}}`,
  },
  {
    kind: "account.terms_changed",
    channel: "email",
    audience: "customer",
    subject: "Your {{companyName}} payment terms have changed",
    body: `Hi {{customerName}},

Your account {{accountName}} is now **{{billingMode}}**.

{{explanation}}

See your balance at {{portalUrl}}.

— {{companyName}}`,
  },
  {
    kind: "account.member_added",
    channel: "email",
    audience: "customer",
    subject: "{{memberEmail}} was added to your {{companyName}} account",
    body: `Hi {{customerName}},

{{memberEmail}} can now book and see deliveries on {{accountName}}, as {{role}}.

If you did not expect this, reply to this email straight away -- anyone on the account can
spend from its wallet.

Manage who has access at {{portalUrl}}.

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
