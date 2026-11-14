import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { FleetService } from "./fleet.service.js";
import { SystemEventsService } from "../system-events/system-events.service.js";

/** What a push says. Kept short: it is read on a lock screen, in a van, at a glance. */
export interface DriverPush {
  title: string;
  body: string;
  /**
   * What the app should do when the notification is opened. `refresh` re-reads the day;
   * `shipmentId` opens that stop. Arbitrary small JSON, delivered as Expo's `data`.
   */
  data?: Record<string, string | number | boolean | null>;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * A tap on the driver's shoulder.
 *
 * The app already polls the day every twenty seconds and re-reads it when it comes to the
 * front. What polling cannot do is wake a phone in a pocket: a driver two suburbs away from a
 * new collection should feel the buzz, not notice the card on their next glance. This is that
 * buzz, through Expo's push service, which speaks to APNs and FCM so the engine does not have
 * to hold either credential.
 *
 * Best effort by design. A push is a hint that something changed, never the record of it: the
 * day list is the record, and nothing here is money (invariant 7 is untouched). So a failed
 * push is logged and recorded in the operational feed, and that is all it is. A token Expo
 * reports as dead is switched off so the next job is not thrown at it again.
 */
@Injectable()
export class DriverPushService {
  constructor(
    private readonly fleet: FleetService,
    private readonly events: SystemEventsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DriverPushService.name);
  }

  /** Whether Expo's push service is reachable from this build at all. Always true: it is public. */
  get configured(): boolean {
    return process.env["DRIVER_PUSH_DISABLED"] !== "1";
  }

  async notify(driverId: string, push: DriverPush): Promise<{ sent: number }> {
    if (!this.configured) return { sent: 0 };
    const tokens = await this.fleet.deviceTokens(driverId);
    if (tokens.length === 0) return { sent: 0 };

    const messages = tokens.map((to) => ({
      to,
      title: push.title,
      body: push.body,
      data: push.data ?? {},
      sound: "default",
      priority: "high",
      channelId: "jobs",
    }));

    let res: Response;
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json",
      };
      // Optional. Expo pushes without one; an access token only matters once the project has
      // enhanced push security switched on in its Expo settings.
      const access = process.env["EXPO_ACCESS_TOKEN"];
      if (access) headers["authorization"] = `Bearer ${access}`;
      res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(messages),
      });
    } catch (err) {
      this.record(driverId, "unreachable", String(err));
      return { sent: 0 };
    }

    const body = (await res.json().catch(() => null)) as {
      data?: { status: string; message?: string; details?: { error?: string } }[];
      errors?: { code: string; message: string }[];
    } | null;

    if (!res.ok || !body?.data) {
      this.record(driverId, `http_${res.status}`, body?.errors?.[0]?.message ?? res.statusText);
      return { sent: 0 };
    }

    let sent = 0;
    for (const [i, ticket] of body.data.entries()) {
      if (ticket.status === "ok") {
        sent++;
        continue;
      }
      const code = ticket.details?.error ?? "unknown";
      // The one error worth acting on: this install is gone (app removed, token rotated).
      if (code === "DeviceNotRegistered") {
        await this.fleet.disableDevice(tokens[i]!, code);
      }
      this.record(driverId, code, ticket.message ?? "push ticket rejected");
    }
    return { sent };
  }

  private record(driverId: string, code: string, detail: string): void {
    this.logger.warn({ driverId, code, detail }, "driver push not delivered");
    this.events.record({
      level: "warning",
      category: "push.driver",
      message: `Push to driver not delivered: ${code}`,
      context: { driverId, code, detail },
      dedupeKey: `push:${driverId}:${code}`,
    });
  }
}
