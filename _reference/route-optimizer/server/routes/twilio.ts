import { Router, Request, Response } from "express";
import Twilio from "twilio";
import { isTwilioConfigured, generateAccessToken, generateTwiml } from "../lib/twilio-service.js";
import { requireDispatcherAuth } from "../middleware/dispatcher-auth.js";
import { publicUrl } from "../lib/public-url.js";

const router = Router();

router.get("/api/twilio/status", requireDispatcherAuth, (_req: Request, res: Response) => {
  res.json({ configured: isTwilioConfigured() });
});

router.post("/api/twilio/token", requireDispatcherAuth, async (req: Request, res: Response) => {
  try {
    if (!isTwilioConfigured()) {
      return res.status(503).json({ message: "Twilio is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER to your environment secrets." });
    }

    const identity = `dispatcher_${req.session.userId}`;
    const token = await generateAccessToken(identity);

    if (!token) {
      return res.status(500).json({ message: "Failed to generate access token. Check Twilio credentials." });
    }

    res.json({ token, identity });
  } catch (err: any) {
    console.error("[Twilio] Token error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

router.post("/api/twilio/voice", (req: Request, res: Response) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const twilioSignature = req.headers["x-twilio-signature"] as string;
    const fullUrl = publicUrl(req.originalUrl);

    const isValid = Twilio.validateRequest(authToken, twilioSignature || "", fullUrl, req.body || {});
    if (!isValid) {
      console.warn("[Twilio] Invalid request signature on /api/twilio/voice");
      res.status(403).send("Forbidden");
      return;
    }
  }

  const to = req.body.To;

  if (!to) {
    res.type("text/xml");
    res.send("<Response><Say>No phone number provided.</Say></Response>");
    return;
  }

  let normalizedNumber = to.replace(/\s+/g, "").replace(/-/g, "");
  if (normalizedNumber.startsWith("0")) {
    normalizedNumber = "+27" + normalizedNumber.slice(1);
  }
  if (!normalizedNumber.startsWith("+")) {
    normalizedNumber = "+" + normalizedNumber;
  }

  const twiml = generateTwiml(normalizedNumber);
  res.type("text/xml");
  res.send(twiml);
});

export default router;
