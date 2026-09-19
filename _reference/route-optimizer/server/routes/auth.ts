import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { storage } from "../storage";
import { registerUserSchema, updateProfileSchema } from "@shared/schema";
import { requireDispatcherAuth } from "../middleware/dispatcher-auth";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

const router = Router();

function sanitizeUser(user: any) {
  const { password, ...rest } = user;
  return rest;
}

router.post("/api/auth/register", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const parsed = registerUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    }
    const { username, password, displayName, email } = parsed.data;
    const existing = await storage.getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ message: "Username already taken" });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = await storage.createUser({ username, password: hashed });
    await storage.updateUser(user.id, {
      displayName,
      email: email || null,
    });
    const updated = await storage.getUser(user.id);
    res.status(201).json({ user: sanitizeUser(updated) });
  } catch (error: any) {
    console.error("[Auth Register]", error.message);
    res.status(500).json({ message: "Registration failed" });
  }
});

router.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }
    const user = await storage.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    await storage.updateUser(user.id, { lastLoginAt: new Date() });
    req.session.regenerate((err) => {
      if (err) {
        console.error("[Auth Login] Session regenerate error:", err);
        return res.status(500).json({ message: "Session error" });
      }
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("[Auth Login] Session save error:", saveErr);
          return res.status(500).json({ message: "Session error" });
        }
        res.json({ user: sanitizeUser(user) });
      });
    });
  } catch (error: any) {
    console.error("[Auth Login]", error.message);
    res.status(500).json({ message: "Login failed" });
  }
});

router.post("/api/auth/logout", (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Logout failed" });
    }
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

router.get("/api/auth/me", async (req: Request, res: Response) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  const user = await storage.getUser(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: "User not found" });
  }
  res.json({ user: sanitizeUser(user) });
});

router.patch("/api/auth/profile", async (req: Request, res: Response) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    }
    const { displayName, email, avatarColor, currentPassword, newPassword } = parsed.data;
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    const updateData: any = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (email !== undefined) updateData.email = email || null;
    if (avatarColor !== undefined) updateData.avatarColor = avatarColor;
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ message: "Current password is required to change password" });
      }
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }
      updateData.password = await bcrypt.hash(newPassword, 10);
    }
    const updated = await storage.updateUser(req.session.userId, updateData);
    res.json({ user: sanitizeUser(updated) });
  } catch (error: any) {
    console.error("[Auth Profile Update]", error.message);
    res.status(500).json({ message: "Profile update failed" });
  }
});

router.get("/api/auth/driver-accounts", requireDispatcherAuth, async (_req: Request, res: Response) => {
  try {
    const accounts = await storage.getAllDriverAccounts();
    res.json(accounts.map((a) => ({
      id: a.id,
      username: a.username,
      driverName: a.driverName,
      phone: a.phone,
      fleetColor: a.fleetColor,
      vehiclePlate: a.vehiclePlate,
      vehicleType: a.vehicleType,
      isOnline: a.isOnline,
      onlineSince: a.onlineSince,
      opsOnlinePending: a.opsOnlinePending,
      opsOnlineRequestedAt: a.opsOnlineRequestedAt,
      lastLoginAt: a.lastLoginAt,
      createdAt: a.createdAt,
    })));
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/api/auth/driver-accounts", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const { username, password, driverName, phone } = req.body;
    if (!username || !password || !driverName) {
      return res.status(400).json({ message: "Username, password, and driver name are required" });
    }
    const normalizedUsername = username.toLowerCase().trim();
    const existing = await storage.getDriverAccountByUsername(normalizedUsername);
    if (existing) {
      return res.status(409).json({ message: "Username already taken" });
    }
    const hashed = await bcrypt.hash(password, 10);
    const account = await storage.createDriverAccount({
      username: normalizedUsername,
      passwordHash: hashed,
      driverName,
      phone: phone?.trim() || "",
      isOnline: false,
      currentLat: null,
      currentLng: null,
      currentAccuracy: null,
      currentSpeed: null,
      currentHeading: null,
      locationUpdatedAt: null,
      lastLoginAt: null,
    });

    try {
      const fleetSetting = await storage.getAppSetting("fleet");
      if (fleetSetting?.value) {
        const raw = typeof fleetSetting.value === "string" ? JSON.parse(fleetSetting.value) : fleetSetting.value;
        const drivers = (raw as any)?.drivers || [];
        const match = drivers.find((d: any) => d.name?.toLowerCase().trim() === driverName.toLowerCase().trim());
        if (match) {
          await storage.updateDriverAccount(account.id, {
            fleetColor: match.color || "#4a9eff",
            vehiclePlate: match.plate || "",
            vehicleType: match.type || "",
          });
        }
      }
    } catch {}

    res.status(201).json({
      id: account.id,
      username: account.username,
      driverName: account.driverName,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.patch("/api/auth/driver-accounts/:id", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const { password, driverName, phone } = req.body;
    const updates: any = {};
    if (password) {
      updates.passwordHash = await bcrypt.hash(password, 10);
    }
    if (driverName) {
      updates.driverName = driverName;
    }
    if (phone !== undefined) {
      updates.phone = phone;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No updates provided" });
    }
    const updated = await storage.updateDriverAccount(id, updates);
    if (!updated) {
      return res.status(404).json({ message: "Driver account not found" });
    }
    res.json({
      id: updated.id,
      username: updated.username,
      driverName: updated.driverName,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.delete("/api/auth/driver-accounts/:id", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const account = await storage.getDriverAccount(id);
    if (!account) {
      return res.status(404).json({ message: "Driver account not found" });
    }
    await storage.deleteDriverAccount(id);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export async function ensureDefaultDispatcher() {
  try {
    const existing = await storage.getUserByUsername("Operations");
    if (!existing) {
      const hashed = await bcrypt.hash("Operations2026#", 10);
      const user = await storage.createUser({ username: "Operations", password: hashed });
      await storage.updateUser(user.id, {
        displayName: "Operations",
      });
      console.log("[Auth] Default dispatcher account created: Operations");
    }
  } catch (error: any) {
    console.error("[Auth] Error creating default dispatcher:", error.message);
  }
}

export default router;
