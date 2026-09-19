import OpenAI from "openai";
import { db } from "../db";
import { sql } from "drizzle-orm";

export interface ReceiptOcrResult {
  rawText: string | null;
  amount: number | null;
  litres: number | null;
  station: string | null;
  date: string | null;
  error: string | null;
}

export interface ClusterOcrResult {
  rawText: string | null;
  odometer: number | null;
  error: string | null;
}

let cachedClient: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (cachedClient) return cachedClient;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  cachedClient = new OpenAI({ apiKey, baseURL: baseURL || undefined });
  return cachedClient;
}

const MODEL = process.env.OCR_MODEL || "gpt-5-mini";

function ensureDataUrl(photo: string): string | null {
  if (!photo) return null;
  if (photo.startsWith("data:")) return photo;
  if (photo.startsWith("http://") || photo.startsWith("https://")) return photo;
  return `data:image/jpeg;base64,${photo}`;
}

function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.\-]/g, "");
    if (!cleaned) return null;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function callVision(photo: string, prompt: string): Promise<{ text: string | null; error: string | null }> {
  const client = getClient();
  if (!client) return { text: null, error: "OCR provider not configured" };
  const url = ensureDataUrl(photo);
  if (!url) return { text: null, error: "Invalid photo payload" };
  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 600,
    });
    const text = resp.choices?.[0]?.message?.content ?? null;
    return { text, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { text: null, error: msg };
  }
}

export async function runClusterOcr(photoDataUrl: string): Promise<ClusterOcrResult> {
  const prompt = `You are extracting data from a photo of a vehicle dashboard cluster taken by a delivery driver.
Return a JSON object: {"odometer": number|null, "raw_text": string}.
- "odometer" is the total odometer reading shown on the cluster, in kilometres, as a number. Use null if unclear.
- "raw_text" is any text/digits you can read from the cluster.
Return ONLY valid JSON, no commentary.`;
  const { text, error } = await callVision(photoDataUrl, prompt);
  if (error || !text) return { rawText: null, odometer: null, error: error || "Empty OCR response" };
  const j = extractJson(text);
  if (!j) return { rawText: text, odometer: null, error: "Could not parse OCR JSON" };
  return {
    rawText: typeof j.raw_text === "string" ? j.raw_text : text,
    odometer: toNumber(j.odometer),
    error: null,
  };
}

export async function runReceiptOcr(photoDataUrl: string): Promise<ReceiptOcrResult> {
  const prompt = `You are extracting data from a photo of a fuel station receipt (petrol/diesel pump slip), often in South African Rand.
Return a JSON object: {"amount": number|null, "litres": number|null, "station": string|null, "date": string|null, "raw_text": string}.
- "amount" is the total Rand amount paid, as a number (no currency symbol).
- "litres" is the volume in litres dispensed, as a number.
- "station" is the fuel station brand or name (e.g. "Shell", "BP Garsfontein").
- "date" is the receipt date in YYYY-MM-DD if visible, otherwise null.
- "raw_text" is the text you can read off the receipt.
Use null for any field you can't determine. Return ONLY valid JSON, no commentary.`;
  const { text, error } = await callVision(photoDataUrl, prompt);
  if (error || !text) {
    return { rawText: null, amount: null, litres: null, station: null, date: null, error: error || "Empty OCR response" };
  }
  const j = extractJson(text);
  if (!j) {
    return { rawText: text, amount: null, litres: null, station: null, date: null, error: "Could not parse OCR JSON" };
  }
  return {
    rawText: typeof j.raw_text === "string" ? j.raw_text : text,
    amount: toNumber(j.amount),
    litres: toNumber(j.litres),
    station: typeof j.station === "string" && j.station.trim() ? j.station.trim() : null,
    date: typeof j.date === "string" && j.date.trim() ? j.date.trim() : null,
    error: null,
  };
}

export async function ocrAndPersistTripPhoto(
  tripId: number,
  side: "start" | "end",
  photo: string,
): Promise<ClusterOcrResult> {
  const result = await runClusterOcr(photo);
  try {
    if (side === "start") {
      await db.execute(sql`
        UPDATE driver_trips
        SET start_odometer_ocr = ${result.odometer == null ? null : String(result.odometer)},
            ocr_raw_text = COALESCE(ocr_raw_text, '') ||
              CASE WHEN ocr_raw_text IS NULL OR ocr_raw_text = '' THEN '' ELSE E'\n---\n' END ||
              ${"START: " + (result.rawText || "")},
            ocr_error = ${result.error},
            ocr_processed_at = NOW()
        WHERE id = ${tripId}
      `);
    } else {
      await db.execute(sql`
        UPDATE driver_trips
        SET end_odometer_ocr = ${result.odometer == null ? null : String(result.odometer)},
            ocr_raw_text = COALESCE(ocr_raw_text, '') ||
              CASE WHEN ocr_raw_text IS NULL OR ocr_raw_text = '' THEN '' ELSE E'\n---\n' END ||
              ${"END: " + (result.rawText || "")},
            ocr_error = ${result.error},
            ocr_processed_at = NOW()
        WHERE id = ${tripId}
      `);
    }
    try {
      const { db: dbm } = await import("../db");
      const { sql: sqlm } = await import("drizzle-orm");
      const row = await dbm.execute<{ driver_account_id: number }>(
        sqlm`SELECT driver_account_id FROM driver_trips WHERE id = ${tripId} LIMIT 1`,
      );
      const did = row.rows?.[0]?.driver_account_id;
      if (did) {
        const { invalidateDriverAccountCache } = await import("./analytics-cache");
        await invalidateDriverAccountCache(Number(did));
      }
    } catch (e) {
      console.warn("[OCR] cache invalidate failed", e instanceof Error ? e.message : e);
    }
  } catch (e) {
    console.error("[OCR] persist trip OCR failed", e instanceof Error ? e.message : e);
  }
  return result;
}

export async function ocrAndPersistExpensePhoto(
  expenseId: number,
  photo: string,
): Promise<ReceiptOcrResult> {
  const result = await runReceiptOcr(photo);
  try {
    await db.execute(sql`
      UPDATE driver_trip_expenses
      SET ocr_text = ${result.rawText},
          ocr_amount = ${result.amount == null ? null : String(result.amount)},
          ocr_litres = ${result.litres == null ? null : String(result.litres)},
          ocr_station = ${result.station},
          ocr_date = ${result.date},
          ocr_error = ${result.error},
          ocr_processed_at = NOW()
      WHERE id = ${expenseId}
    `);
    try {
      const row = await db.execute<{ driver_account_id: number | null; trip_account_id: number | null }>(sql`
        SELECT e.driver_account_id, t.driver_account_id AS trip_account_id
        FROM driver_trip_expenses e
        LEFT JOIN driver_trips t ON t.id = e.trip_id
        WHERE e.id = ${expenseId} LIMIT 1
      `);
      const did = row.rows?.[0]?.driver_account_id ?? row.rows?.[0]?.trip_account_id ?? null;
      if (did) {
        const { invalidateDriverAccountCache } = await import("./analytics-cache");
        await invalidateDriverAccountCache(Number(did));
      }
    } catch (e) {
      console.warn("[OCR] cache invalidate failed", e instanceof Error ? e.message : e);
    }
  } catch (e) {
    console.error("[OCR] persist expense OCR failed", e instanceof Error ? e.message : e);
  }
  return result;
}

export function isOcrConfigured(): boolean {
  return !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
}
