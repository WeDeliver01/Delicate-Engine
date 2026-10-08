import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type {
  AdminCopySettings,
  Notification,
  NotificationAudience,
  NotificationChannel,
  NotificationChannelStatus,
  NotificationKind,
  NotificationPreferences,
  NotificationStatus,
  NotificationTemplate,
  UpdateNotificationPreferencesRequest,
  UpdateTemplateRequest,
} from "@delicate/contracts";
import {
  notificationPreferences,
  notificationTemplates,
  notifications,
  type DbExecutor,
} from "@delicate/db";
import { DbService } from "../../infra/db.module.js";
import { AuditService } from "../../infra/audit.service.js";
import { renderEmailHtml } from "./email-layout.js";
import { SettingsService } from "../../infra/settings.service.js";
import { Clock } from "../../infra/clock.js";
import { AppError } from "../../common/errors.js";
import { TEMPLATE_SEEDS, render } from "./templates.js";
import { NOTIFICATION_TRANSPORTS, type NotificationTransport } from "./transports/transport.js";

export interface EnqueueInput {
  kind: NotificationKind;
  audience: NotificationAudience;
  /** Where to send it. A null address suppresses the message rather than failing. */
  to: string | null;
  payload: Record<string, unknown>;
  accountId?: string | null;
  shipmentId?: string | null;
  /** Unique per business fact, so a redelivered event cannot message someone twice. */
  dedupeKey: string;
  /** Override the template's channel, e.g. to reach a recipient who only gave a phone number. */
  channel?: NotificationChannel;
}

/**
 * Notifications (Phase 4B).
 *
 * Enqueue writes the rendered message down *inside the caller's transaction*, then the worker
 * sends it. That ordering matters: a message is a claim about something that happened, so it
 * must not exist if the thing rolled back, and must not be lost if the mail host is down.
 *
 * Nothing is ever silently discarded. No template, no address, an opted-out account or an
 * unconfigured channel all produce a `suppressed` row carrying the reason, which the console
 * counts — so an unwired channel is visible rather than a void.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly dbs: DbService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(NOTIFICATION_TRANSPORTS) private readonly transports: NotificationTransport[],
  ) {}

  /** Absolute base URL of the portal, for links and the logo in the email layout. */
  private get webUrl(): string {
    return process.env["WEB_PUBLIC_URL"] ?? "http://localhost:3000";
  }

  /** Copy the shipped templates in once. Never overwrites: the operator owns the words. */
  async seedTemplates(): Promise<void> {
    await this.dbs.transaction(async (tx) => {
      for (const t of TEMPLATE_SEEDS) {
        await tx
          .insert(notificationTemplates)
          .values(t)
          .onConflictDoNothing({
            target: [
              notificationTemplates.kind,
              notificationTemplates.channel,
              notificationTemplates.audience,
            ],
          });
      }
    });
  }

  // ── enqueue ───────────────────────────────────────────────────────────────────

  async enqueue(tx: DbExecutor, input: EnqueueInput): Promise<void> {
    const templates = await tx
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.kind, input.kind),
          eq(notificationTemplates.audience, input.audience),
          input.channel ? eq(notificationTemplates.channel, input.channel) : undefined,
        ),
      );
    if (templates.length === 0) return; // nothing configured to say for this event

    const prefs = input.accountId ? await this.preferencesFor(tx, input.accountId) : null;
    const chosen = this.oneInstantChannel(templates, prefs);
    const company = await this.settings.get("company.tax_profile", tx);
    const payload = { companyName: company.tradingName ?? company.legalName, ...input.payload };

    for (const template of chosen) {
      const suppression = this.suppressionReason(template, input, prefs);
      const body = render(template.body, payload);
      const subject = template.subject ? render(template.subject, payload) : null;

      await tx
        .insert(notifications)
        .values({
          kind: input.kind,
          channel: template.channel,
          audience: template.audience,
          status: suppression ? "suppressed" : "queued",
          accountId: input.accountId ?? null,
          shipmentId: input.shipmentId ?? null,
          toAddress: input.to ?? "",
          subject,
          body,
          payload,
          detail: suppression,
          // Stamped from the engine's clock, not the database's: the dispatcher compares this
          // against the same clock, and two sources of "now" only ever drift apart.
          nextAttemptAt: this.clock.now(),
          dedupeKey: `${input.dedupeKey}:${template.channel}:${template.audience}`,
        })
        .onConflictDoNothing({ target: notifications.dedupeKey });
    }
  }

  /**
   * At most one instant message per person per event.
   *
   * Email and a text are different enough to be worth both — one is a record, one is a nudge.
   * An SMS *and* a WhatsApp saying the identical thing is just the same person being told
   * twice, and the person it happens to is the recipient waiting at a door, who did not ask us
   * for either. So when both exist for the same audience, WhatsApp wins where it can actually
   * send and the account allows it, and the SMS is dropped before it is ever written down.
   */
  private oneInstantChannel(
    templates: (typeof notificationTemplates.$inferSelect)[],
    prefs: NotificationPreferences | null,
  ) {
    const instant = templates.filter((t) => t.channel === "sms" || t.channel === "whatsapp");
    if (instant.length < 2) return templates;

    const whatsapp = instant.find((t) => t.channel === "whatsapp");
    const usable =
      whatsapp?.enabled &&
      prefs?.whatsapp !== false &&
      this.transports.find((t) => t.channel === "whatsapp")?.status().configured;

    const drop = usable ? "sms" : "whatsapp";
    // Only the losing instant channel is removed, per audience: a customer's email and a
    // recipient's message are separate decisions.
    const losers = new Set(instant.filter((t) => t.channel === drop).map((t) => t.id));
    return templates.filter((t) => !losers.has(t.id));
  }

  /** Why this message will not be sent, or null to send it. */
  private suppressionReason(
    template: typeof notificationTemplates.$inferSelect,
    input: EnqueueInput,
    prefs: NotificationPreferences | null,
  ): string | null {
    if (!template.enabled) return "This template is switched off.";
    if (!input.to) {
      return template.channel === "email"
        ? "No email address on file for this recipient."
        : "No phone number on file for this recipient.";
    }
    if (prefs) {
      if (template.channel === "email" && !prefs.email)
        return "The account has opted out of email.";
      if (template.channel === "sms" && !prefs.sms) return "The account has opted out of SMS.";
      if (template.channel === "whatsapp" && !prefs.whatsapp)
        return "The account has not opted in to WhatsApp.";
      if (template.audience === "recipient" && !prefs.notifyRecipients)
        return "The account has asked us not to contact their recipients.";
    }
    const transport = this.transports.find((t) => t.channel === template.channel);
    if (!transport) return `No ${template.channel} transport exists.`;
    const status = transport.status();
    return status.configured ? null : status.detail;
  }

  /**
   * The internal address to copy on a message, or null.
   *
   * Only email, because a copy of an SMS is not a thing, and never when the office is already
   * the recipient — a mail addressed to admin@ and blind-copied to admin@ arrives twice.
   */
  private adminCopyFor(
    kind: string,
    channel: NotificationChannel,
    to: string,
    settings: AdminCopySettings | null,
  ): string | null {
    if (!settings?.enabled || channel !== "email") return null;
    if (to.toLowerCase() === settings.address.toLowerCase()) return null;
    const wanted = settings.kinds === "all" || settings.kinds.includes(kind as NotificationKind);
    return wanted ? settings.address : null;
  }

  // ── sending ───────────────────────────────────────────────────────────────────

  /**
   * Send what is due. Called by the worker on a timer; claims rows with `FOR UPDATE SKIP LOCKED`
   * so two workers never send the same message twice. Returns how many it attempted.
   */
  async dispatchDue(limit = 20): Promise<number> {
    const now = this.clock.now();
    const claimed = await this.dbs.transaction(async (tx) => {
      const due = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            inArray(notifications.status, ["queued", "failed"]),
            lte(notifications.nextAttemptAt, now),
          ),
        )
        .orderBy(notifications.nextAttemptAt)
        .limit(limit)
        .for("update", { skipLocked: true });
      if (due.length === 0) return [];
      const ids = due.map((d) => d.id);
      await tx
        .update(notifications)
        .set({ status: "sending", attempts: sql`${notifications.attempts} + 1` })
        .where(inArray(notifications.id, ids));
      return ids;
    });

    const company = await this.settings.get("company.tax_profile");
    const fromName = company.tradingName ?? company.legalName;
    const adminCopy = await this.settings.get("notifications.admin_copy").catch(() => null);

    for (const id of claimed) {
      const row = await this.dbs.db.query.notifications.findFirst({
        where: eq(notifications.id, id),
      });
      if (!row) continue;
      const transport = this.transports.find((t) => t.channel === row.channel);
      try {
        if (!transport) throw new Error(`no ${row.channel} transport`);
        const result = await transport.send({
          to: row.toAddress,
          subject: row.subject,
          body: row.body,
          fromName,
          // Built here rather than stored on the row, so restyling the layout changes every
          // message from the next send onwards -- including ones already queued -- instead
          // of baking the design of the day into the database forever.
          html:
            row.channel === "email"
              ? renderEmailHtml({
                  heading: row.subject,
                  body: row.body,
                  company: {
                    name: fromName,
                    legalName: company.legalName,
                    address: company.address?.formatted ?? null,
                    email: company.email ?? null,
                    phone: company.phone ?? null,
                    waSubject: row.subject,
                  },
                  webUrl: this.webUrl,
                })
              : null,
          bcc: this.adminCopyFor(row.kind, row.channel, row.toAddress, adminCopy),
        });
        await this.dbs.db
          .update(notifications)
          .set({
            status: "sent",
            sentAt: this.clock.now(),
            providerMessageId: result.providerMessageId,
            detail: null,
          })
          .where(eq(notifications.id, id));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const dead = row.attempts + 1 >= row.maxAttempts;
        await this.dbs.db
          .update(notifications)
          .set({
            status: dead ? "dead" : "failed",
            detail: message.slice(0, 500),
            // Back off: 1, 2, 4, 8… minutes, so a mail host outage is not hammered.
            nextAttemptAt: new Date(
              this.clock.now().getTime() + 60_000 * 2 ** Math.min(row.attempts, 6),
            ),
          })
          .where(eq(notifications.id, id));
      }
    }
    return claimed.length;
  }

  /** Re-queue something that failed, after fixing whatever broke. Audited. */
  async requeue(id: string): Promise<Notification> {
    return this.dbs.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(notifications)
        .where(eq(notifications.id, id))
        .for("update");
      if (!row) throw AppError.notFound("notification");
      if (row.status === "sent") {
        throw AppError.conflict("already_sent", "this message has already been sent");
      }
      const [updated] = await tx
        .update(notifications)
        .set({
          status: "queued",
          attempts: 0,
          nextAttemptAt: this.clock.now(),
          detail: null,
        })
        .where(eq(notifications.id, id))
        .returning();
      await this.audit.record(tx, {
        action: "notification.requeue",
        entityType: "notification",
        entityId: id,
        before: { status: row.status, detail: row.detail },
        after: { status: "queued" },
      });
      return toNotification(updated!);
    });
  }

  // ── reads ─────────────────────────────────────────────────────────────────────

  async list(opts: {
    status?: NotificationStatus;
    channel?: NotificationChannel;
    accountId?: string;
    limit?: number;
  }): Promise<Notification[]> {
    const rows = await this.dbs.db
      .select()
      .from(notifications)
      .where(
        and(
          opts.status ? eq(notifications.status, opts.status) : undefined,
          opts.channel ? eq(notifications.channel, opts.channel) : undefined,
          opts.accountId ? eq(notifications.accountId, opts.accountId) : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200));
    return rows.map(toNotification);
  }

  /** Per-channel health: is it wired up, and what has it done in the last day. */
  async channels(): Promise<NotificationChannelStatus[]> {
    const since = new Date(this.clock.now().getTime() - 86_400_000);
    const counts = await this.dbs.db
      .select({
        channel: notifications.channel,
        status: notifications.status,
        n: sql<string>`count(*)::int`,
      })
      .from(notifications)
      .where(gte(notifications.createdAt, since))
      .groupBy(notifications.channel, notifications.status);
    const queued = await this.dbs.db
      .select({ channel: notifications.channel, n: sql<string>`count(*)::int` })
      .from(notifications)
      .where(inArray(notifications.status, ["queued", "failed"]))
      .groupBy(notifications.channel);

    const count = (channel: string, status: string) =>
      Number(counts.find((c) => c.channel === channel && c.status === status)?.n ?? 0);

    return this.transports.map((t) => {
      const status = t.status();
      return {
        channel: t.channel,
        configured: status.configured,
        provider: t.provider,
        detail: status.detail,
        queued: Number(queued.find((q) => q.channel === t.channel)?.n ?? 0),
        sent24h: count(t.channel, "sent"),
        failed24h: count(t.channel, "failed") + count(t.channel, "dead"),
        suppressed24h: count(t.channel, "suppressed"),
      };
    });
  }

  async templates(): Promise<NotificationTemplate[]> {
    const rows = await this.dbs.db
      .select()
      .from(notificationTemplates)
      .orderBy(notificationTemplates.kind, notificationTemplates.channel);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as NotificationKind,
      channel: r.channel,
      audience: r.audience,
      subject: r.subject,
      body: r.body,
      enabled: r.enabled,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async updateTemplate(id: string, body: UpdateTemplateRequest): Promise<NotificationTemplate> {
    return this.dbs.transaction(async (tx) => {
      const before = await tx.query.notificationTemplates.findFirst({
        where: eq(notificationTemplates.id, id),
      });
      if (!before) throw AppError.notFound("template");
      const [row] = await tx
        .update(notificationTemplates)
        .set({
          subject: body.subject === undefined ? before.subject : body.subject,
          body: body.body ?? before.body,
          enabled: body.enabled ?? before.enabled,
        })
        .where(eq(notificationTemplates.id, id))
        .returning();
      await this.audit.record(tx, {
        action: "notification.template.update",
        entityType: "notification_template",
        entityId: id,
        before: { subject: before.subject, body: before.body, enabled: before.enabled },
        after: { subject: row!.subject, body: row!.body, enabled: row!.enabled },
      });
      return {
        id: row!.id,
        kind: row!.kind as NotificationKind,
        channel: row!.channel,
        audience: row!.audience,
        subject: row!.subject,
        body: row!.body,
        enabled: row!.enabled,
        updatedAt: row!.updatedAt.toISOString(),
      };
    });
  }

  // ── preferences ───────────────────────────────────────────────────────────────

  async preferencesFor(tx: DbExecutor, accountId: string): Promise<NotificationPreferences> {
    const row = await tx.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.accountId, accountId),
    });
    return {
      accountId,
      email: row?.email ?? true,
      sms: row?.sms ?? true,
      whatsapp: row?.whatsapp ?? false,
      notifyRecipients: row?.notifyRecipients ?? true,
      lowBalanceCents: row?.lowBalanceCents ?? 20_000,
    };
  }

  async preferences(accountId: string): Promise<NotificationPreferences> {
    return this.preferencesFor(this.dbs.db, accountId);
  }

  async setPreferences(
    accountId: string,
    body: UpdateNotificationPreferencesRequest,
  ): Promise<NotificationPreferences> {
    return this.dbs.transaction(async (tx) => {
      const before = await this.preferencesFor(tx, accountId);
      const merged = { ...before, ...body, accountId };
      await tx
        .insert(notificationPreferences)
        .values(merged)
        .onConflictDoUpdate({ target: notificationPreferences.accountId, set: merged });
      await this.audit.record(tx, {
        action: "notification.preferences.update",
        entityType: "account",
        entityId: accountId,
        before,
        after: merged,
      });
      return merged;
    });
  }
}

/** Addresses are redacted on the way out: an admin list is not a reason to leak contact details. */
export function redact(value: string): string {
  if (!value) return "";
  if (value.includes("@")) {
    const [user, domain] = value.split("@");
    const head = user!.slice(0, 2);
    return `${head}${"•".repeat(Math.max(1, user!.length - 2))}@${domain}`;
  }
  return `${"•".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function toNotification(r: typeof notifications.$inferSelect): Notification {
  return {
    id: r.id,
    kind: r.kind as NotificationKind,
    channel: r.channel,
    audience: r.audience,
    status: r.status,
    accountId: r.accountId,
    shipmentId: r.shipmentId,
    to: redact(r.toAddress),
    subject: r.subject,
    body: r.body,
    attempts: r.attempts,
    detail: r.detail,
    providerMessageId: r.providerMessageId,
    sentAt: r.sentAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
