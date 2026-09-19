export function fmtMoney(v: number | string | null | undefined, currency: string = "ZAR"): string {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `R${Math.round(n).toLocaleString("en-ZA")}`;
  }
}

export function fmtMoneyPrecise(v: number | string | null | undefined, currency: string = "ZAR"): string {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `R${n.toFixed(2)}`;
  }
}
