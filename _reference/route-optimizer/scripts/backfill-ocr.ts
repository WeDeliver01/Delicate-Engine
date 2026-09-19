import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { ocrAndPersistTripPhoto, ocrAndPersistExpensePhoto, isOcrConfigured } from "../server/lib/ocr";

async function main() {
  if (!isOcrConfigured()) {
    console.error("[backfill-ocr] OCR provider not configured (missing AI_INTEGRATIONS_OPENAI_API_KEY/OPENAI_API_KEY).");
    process.exit(1);
  }

  const onlyFailed = process.argv.includes("--retry-failed");

  const tripWhere = onlyFailed
    ? sql`(ocr_processed_at IS NULL OR ocr_error IS NOT NULL)`
    : sql`ocr_processed_at IS NULL`;

  const trips = await db.execute<{
    id: number; start_cluster_photo: string | null; end_cluster_photo: string | null; status: string;
  }>(sql`
    SELECT id, start_cluster_photo, end_cluster_photo, status
    FROM driver_trips
    WHERE ${tripWhere}
      AND (start_cluster_photo IS NOT NULL OR end_cluster_photo IS NOT NULL)
    ORDER BY id ASC
  `);

  console.log(`[backfill-ocr] ${trips.rows.length} trips to process`);

  let tOk = 0; let tFail = 0;
  for (const row of trips.rows) {
    try {
      if (row.start_cluster_photo) {
        const r = await ocrAndPersistTripPhoto(row.id, "start", row.start_cluster_photo);
        if (r.error) console.warn(`  trip ${row.id} start: ${r.error}`);
      }
      if (row.end_cluster_photo) {
        const r = await ocrAndPersistTripPhoto(row.id, "end", row.end_cluster_photo);
        if (r.error) console.warn(`  trip ${row.id} end: ${r.error}`);
      }
      tOk++;
      console.log(`  trip ${row.id} ok`);
    } catch (e) {
      tFail++;
      console.error(`  trip ${row.id} fail`, e instanceof Error ? e.message : e);
    }
  }

  const expWhere = onlyFailed
    ? sql`(ocr_processed_at IS NULL OR ocr_error IS NOT NULL)`
    : sql`ocr_processed_at IS NULL`;

  const expenses = await db.execute<{ id: number; receipt_url: string | null }>(sql`
    SELECT id, receipt_url
    FROM driver_trip_expenses
    WHERE ${expWhere}
      AND receipt_url IS NOT NULL
      AND receipt_url <> ''
    ORDER BY id ASC
  `);

  console.log(`[backfill-ocr] ${expenses.rows.length} expenses to process`);
  let eOk = 0; let eFail = 0;
  for (const row of expenses.rows) {
    try {
      const r = await ocrAndPersistExpensePhoto(row.id, row.receipt_url!);
      if (r.error) console.warn(`  expense ${row.id}: ${r.error}`);
      eOk++;
      console.log(`  expense ${row.id} ok`);
    } catch (e) {
      eFail++;
      console.error(`  expense ${row.id} fail`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`[backfill-ocr] done. trips ok=${tOk} fail=${tFail}; expenses ok=${eOk} fail=${eFail}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[backfill-ocr] fatal", e);
  process.exit(1);
});
