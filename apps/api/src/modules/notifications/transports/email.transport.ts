import { createTransport, type Transporter } from "nodemailer";
import type { NotificationChannel } from "@delicate/contracts";
import type { Env } from "../../../config/env.js";
import type { NotificationTransport, OutboundMessage, SendResult } from "./transport.js";

/**
 * Email over SMTP. Deliberately not a vendor SDK: SMTP works with whatever the business already
 * has — its own mail host, SendGrid, Postmark, Amazon SES — so email needs no vendor decision
 * before it can be switched on.
 */
export class EmailTransport implements NotificationTransport {
  readonly channel: NotificationChannel = "email";
  readonly provider = "smtp";
  private transporter: Transporter | null = null;

  constructor(private readonly env: Env) {}

  status(): { configured: boolean; detail: string | null } {
    if (!this.env.SMTP_HOST) {
      return { configured: false, detail: "SMTP_HOST is not set, so no email can be sent." };
    }
    if (!this.env.SMTP_FROM) {
      return {
        configured: false,
        detail: "SMTP_FROM is not set; mail hosts reject a message with no sender.",
      };
    }
    return { configured: true, detail: null };
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    this.transporter ??= createTransport({
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      secure: this.env.SMTP_PORT === 465,
      auth: this.env.SMTP_USER
        ? { user: this.env.SMTP_USER, pass: this.env.SMTP_PASSWORD }
        : undefined,
    });
    const info = await this.transporter.sendMail({
      from: `"${message.fromName}" <${this.env.SMTP_FROM}>`,
      to: message.to,
      bcc: message.bcc ?? undefined,
      subject: message.subject ?? message.fromName,
      text: message.body,
    });
    return { providerMessageId: info.messageId ?? null };
  }
}
