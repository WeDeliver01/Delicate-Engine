import type { NotificationChannel } from "@delicate/contracts";

/**
 * Outbound message boundary. One transport per channel; the dispatcher never knows which vendor
 * is behind it.
 *
 * A transport that is not configured returns `configured: false` with a reason rather than
 * throwing or pretending to send. The dispatcher then records the message as `suppressed` with
 * that reason, so an unwired channel is visible in the console instead of silently discarding
 * everything it is handed.
 */
export interface NotificationTransport {
  readonly channel: NotificationChannel;
  /** Vendor name for the console, e.g. "smtp", "none". */
  readonly provider: string;
  /** Configured well enough to actually send, and if not, why not. */
  status(): { configured: boolean; detail: string | null };
  send(message: OutboundMessage): Promise<SendResult>;
}

export interface OutboundMessage {
  to: string;
  subject: string | null;
  body: string;
  /** For an email "from" line and an SMS sender id. */
  fromName: string;
}

export interface SendResult {
  providerMessageId: string | null;
}

export const NOTIFICATION_TRANSPORTS = Symbol("NOTIFICATION_TRANSPORTS");
