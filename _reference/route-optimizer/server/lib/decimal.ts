// Fixed-point decimal helpers. All values are stored as strings.
// Arithmetic is performed in BigInt at SCALE decimal places to avoid
// IEEE-754 floating-point drift in financial calculations.

const SCALE = 6;
const SCALE_BI = 10n ** BigInt(SCALE);

function parseToBI(x: string | number | null | undefined): bigint {
  if (x == null) return 0n;
  let s = typeof x === "number" ? (Number.isFinite(x) ? x.toString() : "0") : x.trim();
  if (!s) return 0n;
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return 0n;
  const [intP, fracP = ""] = s.split(".");
  const frac = (fracP + "0".repeat(SCALE)).slice(0, SCALE);
  const bi = BigInt(intP) * SCALE_BI + BigInt(frac || "0");
  return neg ? -bi : bi;
}

function formatBI(bi: bigint, places = 4): string {
  const neg = bi < 0n;
  const abs = neg ? -bi : bi;
  const intPart = abs / SCALE_BI;
  const fracPart = abs % SCALE_BI;
  const fracStr = fracPart.toString().padStart(SCALE, "0");
  let out = `${intPart}.${fracStr}`;
  if (places < SCALE) {
    // round half-up
    const cutoff = SCALE - places;
    const keep = fracStr.slice(0, places);
    const next = fracStr.charAt(places) || "0";
    let rounded = `${intPart}.${keep || "0"}`;
    if (parseInt(next, 10) >= 5) {
      const inc = 10n ** BigInt(cutoff);
      const total = abs + inc;
      const ip = total / SCALE_BI;
      const fp = (total % SCALE_BI).toString().padStart(SCALE, "0").slice(0, places);
      rounded = places === 0 ? `${ip}` : `${ip}.${fp}`;
    }
    out = rounded;
  } else if (places > SCALE) {
    out = out + "0".repeat(places - SCALE);
  }
  if (places === 0) out = out.split(".")[0];
  return neg && bi !== 0n ? `-${out}` : out;
}

export function dAdd(a: string | number | null | undefined, b: string | number | null | undefined): string {
  return formatBI(parseToBI(a) + parseToBI(b), 4);
}

export function dSub(a: string | number | null | undefined, b: string | number | null | undefined): string {
  return formatBI(parseToBI(a) - parseToBI(b), 4);
}

export function dMul(a: string | number | null | undefined, b: string | number | null | undefined): string {
  const r = (parseToBI(a) * parseToBI(b)) / SCALE_BI;
  return formatBI(r, 4);
}

export function dDiv(a: string | number | null | undefined, b: string | number | null | undefined): string {
  const bb = parseToBI(b);
  if (bb === 0n) return "0";
  const r = (parseToBI(a) * SCALE_BI) / bb;
  return formatBI(r, 4);
}

export function dToFixed(a: string | number | null | undefined, places = 2): string {
  return formatBI(parseToBI(a), places);
}

export function dPct(numerator: string | number | null | undefined, denominator: string | number | null | undefined): string | null {
  const dn = parseToBI(denominator);
  if (dn === 0n) return null;
  const r = (parseToBI(numerator) * 100n * SCALE_BI) / dn;
  return formatBI(r, 2);
}

export function fmtMoney(s: string | number | null | undefined, currency = "ZAR"): string {
  const formatted = dToFixed(s, 2);
  const n = parseFloat(formatted);
  try {
    return new Intl.NumberFormat("en-ZA", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(isFinite(n) ? n : 0);
  } catch {
    return `${currency} ${formatted}`;
  }
}
