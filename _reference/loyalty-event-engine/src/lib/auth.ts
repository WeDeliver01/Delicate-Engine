import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";

// ── Customer portal tokens (issued by this service) ──────────────────────────
export interface CustomerClaims {
  sub: string; // customer_users.id
  nodeId: string;
  role: string;
}

export function signCustomerToken(claims: CustomerClaims): string {
  const secret = process.env.CUSTOMER_JWT_SECRET;
  if (!secret) throw new Error("CUSTOMER_JWT_SECRET is not set");
  return jwt.sign(claims, secret, { expiresIn: "30d" });
}

export function verifyCustomerToken(token: string): CustomerClaims {
  const secret = process.env.CUSTOMER_JWT_SECRET;
  if (!secret) throw new Error("CUSTOMER_JWT_SECRET is not set");
  return jwt.verify(token, secret) as CustomerClaims;
}

// ── Driver tokens (issued by the Route Optimizer) ────────────────────────────
// Verified with the SHARED SESSION_SECRET so drivers stay logged in once.
// We do not trust any specific claim shape; we only confirm the signature and
// pull out a driver identifier from the common fields.
export interface DriverClaims {
  driverId: string;
  raw: Record<string, unknown>;
}

export function verifyDriverToken(token: string): DriverClaims {
  const secret = process.env.ROUTE_OPTIMIZER_SESSION_SECRET;
  if (!secret) throw new Error("ROUTE_OPTIMIZER_SESSION_SECRET is not set");
  const decoded = jwt.verify(token, secret) as Record<string, unknown>;
  const driverId = String(
    decoded.driverId ?? decoded.sub ?? decoded.id ?? decoded.driver_id ?? "",
  );
  if (!driverId) throw new Error("Driver token has no recognizable id field");
  return { driverId, raw: decoded };
}

// ── Password hashing ─────────────────────────────────────────────────────────
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
export async function checkPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── Middleware ───────────────────────────────────────────────────────────────
export interface AuthedRequest extends Request {
  customer?: CustomerClaims;
}

function bearer(req: Request): string | null {
  const h = req.header("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length).trim();
}

export function requireCustomer(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "missing bearer token" });
  try {
    req.customer = verifyCustomerToken(token);
    next();
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return res.status(500).json({ error: "ADMIN_API_KEY not configured" });
  if (req.header("x-admin-key") !== expected) {
    return res.status(401).json({ error: "invalid admin key" });
  }
  next();
}
