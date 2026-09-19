// All wallet money is stored and computed in integer cents (ZAR) to avoid
// floating point drift. Format only at the edge, for display.

export function randToCents(rand: number): number {
  return Math.round(rand * 100);
}

export function centsToRand(cents: number): number {
  return cents / 100;
}

export function formatZar(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-ZA");
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}R${whole}.${frac}`;
}

/** Cash back for a spend, given a rate in basis points (200 bps = 2%). */
export function cashbackCents(spendCents: number, bps: number): number {
  return Math.round((spendCents * bps) / 10_000);
}
