import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { TRACKING_TOKEN_PREFIX, TrackingToken } from "@delicate/contracts";
import { shipmentTrackingTokens } from "@delicate/db";
import { DbService, type DbExecutor } from "../../infra/db.module.js";

/**
 * Issues and resolves the token behind a recipient's live-tracking link.
 *
 * Issuing is idempotent on purpose. The same shipment can be announced more than once — out
 * for delivery, then "ten minutes away", then a second attempt tomorrow — and every one of
 * those messages has to carry a link that still works. So the first call mints a token and
 * every later call hands back the same one.
 */
@Injectable()
export class TrackingTokenService {
  constructor(private readonly dbs: DbService) {}

  /** The token for this shipment, minting one if it has none. Safe to call concurrently. */
  async issue(tx: DbExecutor, shipmentId: string): Promise<string> {
    const token = `${TRACKING_TOKEN_PREFIX}${randomBytes(16).toString("base64url")}`;
    // Two notifications for the same shipment can be composed at once. Whichever insert loses
    // the race does nothing, and the read below gives both callers the winner's token rather
    // than one of them handing out a token no row holds.
    await tx
      .insert(shipmentTrackingTokens)
      .values({ shipmentId, token })
      .onConflictDoNothing({ target: shipmentTrackingTokens.shipmentId });
    const [row] = await tx
      .select({ token: shipmentTrackingTokens.token })
      .from(shipmentTrackingTokens)
      .where(eq(shipmentTrackingTokens.shipmentId, shipmentId));
    return row?.token ?? token;
  }

  /**
   * The link to put in a message. Built here rather than in each caller so the token and the
   * page that reads it cannot drift apart.
   */
  async linkFor(tx: DbExecutor, shipmentId: string): Promise<string> {
    const base = (process.env["WEB_PUBLIC_URL"] ?? "http://localhost:3000").replace(/\/$/, "");
    return `${base}/live/${await this.issue(tx, shipmentId)}`;
  }

  /** The shipment a token stands for, or null — a revoked or unknown token is simply not one. */
  async resolve(token: string): Promise<string | null> {
    if (!TrackingToken.safeParse(token).success) return null;
    const [row] = await this.dbs.db
      .select({ shipmentId: shipmentTrackingTokens.shipmentId })
      .from(shipmentTrackingTokens)
      .where(
        and(eq(shipmentTrackingTokens.token, token), isNull(shipmentTrackingTokens.revokedAt)),
      );
    return row?.shipmentId ?? null;
  }
}
