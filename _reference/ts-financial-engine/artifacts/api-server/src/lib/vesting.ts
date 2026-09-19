const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TUESDAY = 2;

export function weekStart(d: Date): Date {
  const sast = new Date(d.getTime() + SAST_OFFSET_MS);
  const daysSinceTue = (sast.getUTCDay() - TUESDAY + 7) % 7;
  const midnightSast = Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate());
  const startSast = midnightSast - daysSinceTue * DAY_MS;
  return new Date(startSast - SAST_OFFSET_MS);
}

export function unlockDate(d: Date): Date {
  return new Date(weekStart(d).getTime() + 7 * DAY_MS);
}

export function isVested(createdAt: Date, asOf: Date = new Date()): boolean {
  return unlockDate(createdAt).getTime() <= asOf.getTime();
}
