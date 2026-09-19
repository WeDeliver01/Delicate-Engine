type CacheEntry = { value: unknown; expiresAt: number };

interface MinimalRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { EX?: number }): Promise<unknown>;
  del(keys: string | string[]): Promise<number>;
  scanIterator(opts: { MATCH: string; COUNT?: number }): AsyncIterable<string>;
  on(event: string, listener: (err: Error) => void): unknown;
  connect(): Promise<unknown>;
}
interface RedisModule {
  createClient(opts: { url: string }): MinimalRedisClient;
}

const memCache = new Map<string, CacheEntry>();
const PREFIX = "analytics:";

let redisClient: MinimalRedisClient | null = null;
let redisInitTried = false;

async function getRedis(): Promise<MinimalRedisClient | null> {
  if (redisInitTried) return redisClient;
  redisInitTried = true;
  if (!process.env.REDIS_URL) return null;
  try {
    let mod: RedisModule;
    try {
      mod = (await import(/* @vite-ignore */ "redis" as string)) as unknown as RedisModule;
    } catch {
      console.warn("[analytics-cache] redis package not installed; using in-memory cache");
      return null;
    }
    const client = mod.createClient({ url: process.env.REDIS_URL });
    client.on("error", (err) => {
      console.warn("[analytics-cache] Redis error:", err?.message || err);
    });
    await client.connect();
    redisClient = client;
    return client;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[analytics-cache] Failed to connect Redis, falling back to memory:", msg);
    return null;
  }
}

export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  const fullKey = PREFIX + key;
  if (process.env.REDIS_URL) {
    try {
      const r = await getRedis();
      if (!r) return null; // Redis configured but unreachable -> no-op
      const v = await r.get(fullKey);
      if (v == null) return null;
      return JSON.parse(v);
    } catch (e) {
      console.warn("[analytics-cache] redis get failed (no-op):", e instanceof Error ? e.message : String(e));
      return null;
    }
  }
  const e = memCache.get(fullKey);
  if (!e) return null;
  if (e.expiresAt < Date.now()) {
    memCache.delete(fullKey);
    return null;
  }
  return e.value as T;
}

export async function cacheSetex(key: string, ttlSeconds: number, value: unknown): Promise<void> {
  const fullKey = PREFIX + key;
  if (process.env.REDIS_URL) {
    try {
      const r = await getRedis();
      if (!r) return; // Redis configured but unreachable -> no-op
      await r.set(fullKey, JSON.stringify(value), { EX: ttlSeconds });
      return;
    } catch (e) {
      console.warn("[analytics-cache] redis set failed (no-op):", e instanceof Error ? e.message : String(e));
      return;
    }
  }
  memCache.set(fullKey, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  if (memCache.size > 1000) {
    const now = Date.now();
    memCache.forEach((v, k) => { if (v.expiresAt < now) memCache.delete(k); });
  }
}

export async function invalidateDriverAccountCache(driverAccountId: number): Promise<void> {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  let analyticsDriverId: string | null = null;
  try {
    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM drivers WHERE driver_account_id = ${driverAccountId} LIMIT 1`,
    );
    analyticsDriverId = rows.rows?.[0]?.id ?? null;
  } catch (e) {
    console.warn("[analytics-cache] driver lookup failed:", e instanceof Error ? e.message : String(e));
  }
  if (analyticsDriverId) {
    await cacheDelByPrefix(`driver:${analyticsDriverId}:`);
  }
  await cacheDelByPrefix("summary:");
}

export async function cacheDelByPrefix(prefix: string): Promise<number> {
  const fullPrefix = PREFIX + prefix;
  let deleted = 0;
  for (const key of Array.from(memCache.keys())) {
    if (key.startsWith(fullPrefix)) {
      memCache.delete(key);
      deleted++;
    }
  }
  if (process.env.REDIS_URL) {
    try {
      const r = await getRedis();
      if (r) {
        const batch: string[] = [];
        const flush = async () => {
          if (batch.length === 0) return;
          deleted += await r.del(batch);
          batch.length = 0;
        };
        for await (const key of r.scanIterator({ MATCH: `${fullPrefix}*`, COUNT: 200 })) {
          batch.push(key);
          if (batch.length >= 200) await flush();
        }
        await flush();
      }
    } catch (e) {
      console.warn("[analytics-cache] redis prefix delete failed (no-op):", e instanceof Error ? e.message : String(e));
    }
  }
  return deleted;
}

export function cacheStatus() {
  return {
    redisEnabled: !!process.env.REDIS_URL,
    redisConnected: !!redisClient,
    memEntries: memCache.size,
  };
}
