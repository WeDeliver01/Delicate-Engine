import Twilio from "twilio";
import { storage } from "../storage.js";
import { publicUrl } from "./public-url.js";

const SETTINGS_KEY = "twilio_config";

interface TwilioConfig {
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
}

function getCredentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !phoneNumber) {
    return null;
  }
  return { accountSid, authToken, phoneNumber };
}

export function isTwilioConfigured(): boolean {
  return getCredentials() !== null;
}

function getWhatsAppFrom(): string | null {
  const explicit = process.env.TWILIO_WHATSAPP_FROM;
  if (explicit) {
    return explicit.startsWith("whatsapp:") ? explicit : `whatsapp:${explicit}`;
  }
  const creds = getCredentials();
  if (!creds) return null;
  return `whatsapp:${creds.phoneNumber}`;
}

export function isTwilioWhatsAppConfigured(): boolean {
  return getCredentials() !== null && getWhatsAppFrom() !== null;
}

export function normalizeZaPhone(raw: string): string {
  const hadPlus = raw.trim().startsWith("+");
  let n = raw.replace(/\D/g, "");
  if (!hadPlus && n.startsWith("0")) {
    n = "27" + n.slice(1);
  }
  return "+" + n;
}

export interface WhatsAppSendResult {
  sid: string;
  status: string;
  to: string;
  from: string;
}

export async function sendWhatsAppMessage(
  toRaw: string,
  body: string,
): Promise<WhatsAppSendResult> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error("Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.");
  }
  const from = getWhatsAppFrom();
  if (!from) {
    throw new Error("WhatsApp sender is not configured. Set TWILIO_WHATSAPP_FROM, or ensure TWILIO_PHONE_NUMBER is WhatsApp-enabled.");
  }
  if (!body.trim()) {
    throw new Error("Message body is empty.");
  }

  const to = `whatsapp:${normalizeZaPhone(toRaw)}`;
  const client = Twilio(creds.accountSid, creds.authToken);

  const message = await client.messages.create({ from, to, body });
  return {
    sid: message.sid,
    status: message.status,
    to,
    from,
  };
}

async function getOrCreateConfig(): Promise<TwilioConfig | null> {
  const creds = getCredentials();
  if (!creds) return null;

  const client = Twilio(creds.accountSid, creds.authToken);
  const voiceUrl = publicUrl("/api/twilio/voice");

  const existing = await storage.getAppSetting(SETTINGS_KEY);
  if (existing?.value) {
    const config = typeof existing.value === "string" ? JSON.parse(existing.value) : existing.value;
    if (config.apiKeySid && config.apiKeySecret && config.twimlAppSid) {
      try {
        const app = await client.applications(config.twimlAppSid).fetch();
        if (app.voiceUrl !== voiceUrl) {
          await client.applications(config.twimlAppSid).update({ voiceUrl, voiceMethod: "POST" });
          console.log(`[Twilio] Updated TwiML app voiceUrl to ${voiceUrl} (was ${app.voiceUrl})`);
        }
      } catch (err: any) {
        console.warn("[Twilio] Could not verify/update TwiML app voiceUrl:", err.message);
      }
      return config as TwilioConfig;
    }
  }

  try {
    const twimlApp = await client.applications.create({
      friendlyName: "Delicate Courier Dispatcher",
      voiceUrl,
      voiceMethod: "POST",
    });

    const apiKey = await client.newKeys.create({
      friendlyName: "Delicate Courier Voice Key",
    });

    const config: TwilioConfig = {
      apiKeySid: apiKey.sid,
      apiKeySecret: apiKey.secret!,
      twimlAppSid: twimlApp.sid,
    };

    await storage.setAppSetting(SETTINGS_KEY, JSON.stringify(config));
    console.log("[Twilio] Auto-configured API key and TwiML app");
    return config;
  } catch (err: any) {
    console.error("[Twilio] Auto-setup failed:", err.message);
    return null;
  }
}

export async function generateAccessToken(identity: string): Promise<string | null> {
  const creds = getCredentials();
  if (!creds) return null;

  const config = await getOrCreateConfig();
  if (!config) return null;

  const AccessToken = Twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: config.twimlAppSid,
    incomingAllow: false,
  });

  const token = new AccessToken(
    creds.accountSid,
    config.apiKeySid,
    config.apiKeySecret,
    { identity, ttl: 3600 }
  );

  token.addGrant(voiceGrant);
  return token.toJwt();
}

export function generateTwiml(toNumber: string): string {
  const creds = getCredentials();
  const callerId = creds?.phoneNumber || "";
  const VoiceResponse = Twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  const dial = response.dial({ callerId });
  dial.number(toNumber);
  return response.toString();
}
