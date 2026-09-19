import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, eventInbox } from "@workspace/db";
import { incomingEvent, PROCESSED_EVENT_TYPES } from "../events/schemas.js";
import { handleEvent } from "../events/handlers.js";

const EVENTS_WEBHOOK_SECRET = process.env["EVENTS_WEBHOOK_SECRET"] ?? "dev-events-secret";

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Verify the HMAC-SHA256 signature over the exact request bytes captured by the
 * global JSON parser's verify hook (see app.ts). The Route Optimizer signs the
 * same way (server/lib/financial-events.ts). Constant-time comparison.
 */
function verifySignature(req: RawBodyRequest, res: Response, next: NextFunction) {
  const provided = (req.headers["x-delicate-signature"] as string | undefined) ?? "";
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", EVENTS_WEBHOOK_SECRET).update(req.rawBody ?? Buffer.alloc(0)).digest("hex");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return void res.status(401).json({ error: "Invalid signature" });
  }
  next();
}

const router: IRouter = Router();

router.post("/", verifySignature, async (req: RawBodyRequest, res: Response) => {
  // 1. Validate the envelope. req.body is already parsed by express.json().
  const result = incomingEvent.safeParse(req.body);
  if (!result.success) {
    return void res.status(400).json({ error: "Invalid event", issues: result.error.issues });
  }
  const event = result.data;

  // 2. Persist to the inbox. Unique on event_id AND dedupe_key, so a duplicate
  //    by either dimension is silently dropped here.
  const [inserted] = await db
    .insert(eventInbox)
    .values({
      eventId: event.eventId,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      source: event.source,
      dedupeKey: event.dedupeKey,
      occurredAt: event.occurredAt,
      payload: event.payload as Record<string, unknown>,
      status: "received",
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    // Already received (same emission or same business fact). Idempotent ack.
    return void res.status(202).json({ accepted: true, duplicate: true });
  }

  // 3. Phase 1: process inline (no queue yet). The event is already durably
  //    stored, so any handler failure is recoverable by replay, we still
  //    return 202 because ingest succeeded.
  if (!PROCESSED_EVENT_TYPES.has(event.eventType)) {
    return void res.status(202).json({ accepted: true, duplicate: false, processed: false });
  }

  try {
    const outcome = await handleEvent(event);
    await db
      .update(eventInbox)
      .set({
        status: outcome.handled ? "processed" : "received",
        processedAt: outcome.handled ? new Date() : null,
        attempts: 1,
      })
      .where(eq(eventInbox.id, inserted.id));

    return void res.status(202).json({
      accepted: true,
      duplicate: false,
      processed: outcome.handled,
      detail: outcome.detail,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await db
      .update(eventInbox)
      .set({ status: "failed", attempts: 1, lastError: message })
      .where(eq(eventInbox.id, inserted.id));
    req.log?.error?.({ err, eventId: event.eventId }, "Event processing failed");
    return void res.status(202).json({ accepted: true, duplicate: false, processed: false, error: message });
  }
});

export default router;
