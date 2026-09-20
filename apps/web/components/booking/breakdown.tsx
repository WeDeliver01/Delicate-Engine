import type { QuoteBreakdown } from "@delicate/contracts";
import { rands } from "@/lib/money";

/** The price explained, line by line — the same numbers the engine persisted. */
export function Breakdown({ b, compact = false }: { b: QuoteBreakdown; compact?: boolean }) {
  return (
    <div className="text-sm">
      {!compact && (
        <ul className="divide-y divide-[#F0EDE9]">
          {b.lines.map((l) => (
            <li key={l.code} className="flex justify-between py-1.5">
              <span className="text-[#3A3631]">{l.label}</span>
              <span className="font-mono">{rands(l.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className={`${compact ? "" : "mt-2 border-t border-[#ECEAE6] pt-2"} space-y-1`}>
        <div className="flex justify-between text-[#6B6661]">
          <span>Subtotal</span>
          <span className="font-mono">{rands(b.subtotalCents)}</span>
        </div>
        {b.vatBps > 0 && (
          <div className="flex justify-between text-[#6B6661]">
            <span>VAT {b.vatBps / 100}%</span>
            <span className="font-mono">{rands(b.vatCents)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-bold text-[#0A0A0A]">
          <span>Total</span>
          <span className="font-mono">{rands(b.totalCents)}</span>
        </div>
        <p className="text-xs text-[#86817A]">
          {b.distanceKm.toFixed(1)} km round trip from our depot
        </p>
      </div>
    </div>
  );
}
