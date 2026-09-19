import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { verifyDriverToken } from "./driver-auth";

export const ANALYTICS_ROLES = ["admin", "manager", "ops", "dispatcher"] as const;
export const ALL_ANALYTICS_ROLES = [...ANALYTICS_ROLES, "driver"] as const;

export interface AnalyticsActor {
  type: "user" | "driver";
  id: string;
  role: string;
  username: string;
}

declare module "express-serve-static-core" {
  interface Request {
    analyticsActor?: AnalyticsActor;
  }
}

async function resolveActor(req: Request): Promise<AnalyticsActor | null> {
  if (req.session?.userId) {
    const user = await storage.getUser(req.session.userId);
    if (user) {
      return { type: "user", id: user.id, role: user.role || "dispatcher", username: user.username };
    }
  }
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    try {
      const token = auth.slice(7);
      const payload = verifyDriverToken(token);
      if (payload?.driverAccountId) {
        const acc = await storage.getDriverAccount(payload.driverAccountId);
        if (acc) {
          return { type: "driver", id: String(acc.id), role: "driver", username: acc.username };
        }
      }
    } catch {}
  }
  return null;
}

export function requireAnalyticsAccess(opts?: { driverIdParam?: string; allowDriverSelf?: boolean }) {
  const driverIdParam = opts?.driverIdParam || "id";
  const allowDriverSelf = opts?.allowDriverSelf !== false;
  return async (req: Request, res: Response, next: NextFunction) => {
    const actor = await resolveActor(req);
    if (!actor) return res.status(401).json({ message: "Not authenticated" });
    if ((ANALYTICS_ROLES as readonly string[]).includes(actor.role)) {
      req.analyticsActor = actor;
      return next();
    }
    if (actor.type === "driver" && allowDriverSelf) {
      const target = req.params[driverIdParam];
      const { resolveDriverIdForActor } = await import("../lib/analytics");
      const myDriverId = await resolveDriverIdForActor(actor);
      if (myDriverId && (target === myDriverId || target === "me")) {
        req.params[driverIdParam] = myDriverId;
        req.analyticsActor = actor;
        return next();
      }
    }
    return res.status(403).json({ message: "Forbidden" });
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  resolveActor(req).then((actor) => {
    if (!actor) return res.status(401).json({ message: "Not authenticated" });
    if (actor.role !== "admin") return res.status(403).json({ message: "Admin only" });
    req.analyticsActor = actor;
    next();
  }).catch(() => res.status(500).json({ message: "Auth error" }));
}
