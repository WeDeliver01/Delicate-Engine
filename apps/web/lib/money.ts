/** Display helpers. Money arrives as integer cents; only formatting turns it into rands. */
export function rands(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-ZA");
  return `${sign}R${whole},${String(abs % 100).padStart(2, "0")}`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
}

export function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", { dateStyle: "medium" });
}

export function minutesToClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
