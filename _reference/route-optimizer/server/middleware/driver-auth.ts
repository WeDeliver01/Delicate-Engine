import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface DriverTokenPayload {
  driverAccountId: number;
  driverName: string;
  username: string;
}

declare global {
  namespace Express {
    interface Request {
      driver?: DriverTokenPayload;
    }
  }
}

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  console.warn("[Driver Auth] WARNING: SESSION_SECRET not set. Driver auth will fail.");
}

export function signDriverToken(payload: DriverTokenPayload): string {
  if (!JWT_SECRET) throw new Error("SESSION_SECRET not configured");
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

export function verifyDriverToken(token: string): DriverTokenPayload | null {
  if (!JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as DriverTokenPayload;
    if (!decoded?.driverAccountId || !decoded?.username) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function requireDriverAuth(req: Request, res: Response, next: NextFunction) {
  if (!JWT_SECRET) {
    return res.status(500).json({ message: "Server auth not configured" });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing or invalid Authorization header" });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as DriverTokenPayload;
    if (!decoded.driverAccountId || !decoded.username) {
      return res.status(401).json({ message: "Invalid token payload" });
    }
    req.driver = decoded;
    next();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired" });
    }
    return res.status(401).json({ message: "Invalid token" });
  }
}
