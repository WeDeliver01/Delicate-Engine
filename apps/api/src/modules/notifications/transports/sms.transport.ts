import type { NotificationChannel } from "@delicate/contracts";
import type { NotificationTransport, OutboundMessage, SendResult } from "./transport.js";

/**
 * SMS and WhatsApp.
 *
 * No provider has been chosen yet — Twilio, Clickatell and the WhatsApp Cloud API are all still
 * on the table — so rather than guess at an API these transports report themselves unconfigured.
 * Every message that would have gone out is still written down and marked `suppressed` with the
 * reason, and the console counts them, so on the day a provider is picked it is obvious what the
 * business has been unable to say.
 *
 * Wiring one up is a `send` implementation here and nothing else: templates, preferences,
 * dedupe, retries and the audit trail already work.
 */
abstract class UnconfiguredTransport implements NotificationTransport {
  abstract readonly channel: NotificationChannel;
  /** The env var that will switch it on, named in the console so nobody has to guess. */
  abstract readonly envKey: string;
  readonly provider = "none";

  status(): { configured: boolean; detail: string | null } {
    return {
      configured: false,
      detail: `No ${this.channel} provider is configured. Pick one (Twilio, Clickatell, WhatsApp Cloud API) and set ${this.envKey}; until then these messages are recorded and suppressed, not sent.`,
    };
  }

  async send(_message: OutboundMessage): Promise<SendResult> {
    // Unreachable: the dispatcher checks status() and suppresses rather than calling send.
    throw new Error(`${this.channel} transport is not configured`);
  }
}

export class SmsTransport extends UnconfiguredTransport {
  readonly channel: NotificationChannel = "sms";
  readonly envKey = "SMS_PROVIDER";
}

export class WhatsAppTransport extends UnconfiguredTransport {
  readonly channel: NotificationChannel = "whatsapp";
  readonly envKey = "WHATSAPP_PROVIDER";
}
