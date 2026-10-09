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
  /**
   * The same message as HTML, where the channel has a use for one. Sent alongside `body`
   * rather than instead of it: a client that cannot or will not render HTML still gets the
   * words, and a text part is worth real deliverability points to spam filters.
   */
  html?: string | null;
  /** For an email "from" line and an SMS sender id. */
  fromName: string;
  /**
   * An internal address copied on this message. Blind, so a customer never sees where their
   * mail is also going, and ignored by channels that have no such concept.
   */
  bcc?: string | null;
  /** Files travelling with the message. Email only; other channels ignore them. */
  attachments?: OutboundAttachment[];
}

/**
 * A file on an email.
 *
 * `cid` makes it an inline image the HTML can reference as `src="cid:<cid>"`. That is the only
 * way a photograph renders everywhere: Gmail and Outlook both strip a `data:` URI, and a link
 * to a hosted image would be a new public surface for pictures of people's doorsteps.
 */
export interface OutboundAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
  cid?: string;
}

export interface SendResult {
  providerMessageId: string | null;
}

export const NOTIFICATION_TRANSPORTS = Symbol("NOTIFICATION_TRANSPORTS");
