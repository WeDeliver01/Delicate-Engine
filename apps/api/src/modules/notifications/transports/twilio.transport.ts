import type { NotificationChannel } from "@delicate/contracts";
import type { Env } from "../../../config/env.js";
import type { NotificationTransport, OutboundMessage, SendResult } from "./transport.js";

/**
 * SMS and WhatsApp through Twilio.
 *
 * One class for both, because to Twilio they are the same REST call with a differently
 * prefixed sender. What differs is what may be sent: an SMS can say anything, while a WhatsApp
 * message to someone who has not written to us first must be a template Meta has approved in
 * advance. That approval is bought outside this code, and a message whose wording has not been
 * approved is rejected by Twilio with a 63016 — which this reports as a plain failure rather
 * than retrying forever, because no amount of retrying will approve it.
 *
 * Called over plain `fetch` rather than the `twilio` SDK: this is one POST with form encoding,
 * and the SDK would be a dependency, a bundle and a version to keep current for that.
 */
export class TwilioTransport implements NotificationTransport {
  readonly provider = "twilio";

  constructor(
    readonly channel: Extract<NotificationChannel, "sms" | "whatsapp">,
    private readonly env: Env,
  ) {}

  /** The sender for this channel, or null when it is not set up. */
  private from(): string | null {
    if (this.env.TWILIO_MESSAGING_SERVICE_SID) return null; // the service picks the sender
    const number =
      this.channel === "whatsapp" ? this.env.TWILIO_WHATSAPP_FROM : this.env.TWILIO_SMS_FROM;
    if (!number) return null;
    return this.channel === "whatsapp" ? `whatsapp:${number}` : number;
  }

  status(): { configured: boolean; detail: string | null } {
    if (!this.env.TWILIO_ACCOUNT_SID || !this.env.TWILIO_AUTH_TOKEN) {
      return {
        configured: false,
        detail:
          "Twilio is not connected. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN; until then these messages are recorded and suppressed, not sent.",
      };
    }
    if (!this.env.TWILIO_MESSAGING_SERVICE_SID && !this.from()) {
      const key = this.channel === "whatsapp" ? "TWILIO_WHATSAPP_FROM" : "TWILIO_SMS_FROM";
      return {
        configured: false,
        detail: `Twilio is connected but has no ${this.channel} sender. Set ${key} or TWILIO_MESSAGING_SERVICE_SID.`,
      };
    }
    if (this.channel === "whatsapp") {
      // Not a failure — it sends — but the one thing most likely to surprise someone who has
      // just switched this on, so the console says it out loud.
      return {
        configured: true,
        detail:
          "Connected. WhatsApp templates must be approved by Meta before they reach anyone who has not messaged you first; edit the wording here and it needs approving again.",
      };
    }
    return { configured: true, detail: null };
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const sid = this.env.TWILIO_ACCOUNT_SID;
    const token = this.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error("twilio is not configured");

    const to = this.channel === "whatsapp" ? `whatsapp:${message.to}` : message.to;
    const body = new URLSearchParams({ To: to, Body: message.body });
    const from = this.from();
    if (this.env.TWILIO_MESSAGING_SERVICE_SID) {
      body.set("MessagingServiceSid", this.env.TWILIO_MESSAGING_SERVICE_SID);
    } else if (from) {
      body.set("From", from);
    }

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      // Longer than a page load but well short of the dispatcher's patience: a hung request
      // holding a claimed row is worse than a failure it can retry.
      signal: AbortSignal.timeout(15_000),
    });

    const payload = (await res.json().catch(() => ({}))) as {
      sid?: string;
      code?: number;
      message?: string;
    };

    if (!res.ok) {
      // Twilio's own code is far more use than the HTTP status when reading this back in the
      // console a week later: 63016 is an unapproved template, 21211 a malformed number.
      throw new Error(
        `twilio ${res.status}${payload.code ? ` (${payload.code})` : ""}: ${
          payload.message ?? "send failed"
        }`,
      );
    }

    return { providerMessageId: payload.sid ?? null };
  }
}
