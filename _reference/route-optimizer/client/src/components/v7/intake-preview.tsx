import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { FileSearch, AlertTriangle } from "lucide-react";
import { useIntakeContext } from "@/hooks/use-dispatch-data";

export function IntakePreview() {
  const { csvResult } = useIntakeContext();

  if (!csvResult) {
    return (
      <EmptyState
        icon={<FileSearch className="size-5" />}
        title="No preview yet"
        description="Drop a ShipLogic CSV or paste rows on the left to see a live preview of parsed shipments here."
      />
    );
  }

  const ships = csvResult.ships.slice(0, 12);
  const more = csvResult.ships.length - ships.length;

  return (
    <Card grain className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-hairline">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-base font-medium text-text-primary tracking-tight">Preview</h3>
          <StatusPill tone="info" size="sm">{csvResult.ships.length} rows</StatusPill>
          {csvResult.warnings.length > 0 && (
            <StatusPill tone="warning" size="sm" dot>
              {csvResult.warnings.length} warning{csvResult.warnings.length === 1 ? "" : "s"}
            </StatusPill>
          )}
        </div>
        {csvResult.accountCodes.length > 0 && (
          <span className="text-[11px] uppercase tracking-[0.14em] text-text-quiet">
            {csvResult.accountCodes.length} account code{csvResult.accountCodes.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="overflow-x-auto max-h-[420px]">
        <table className="w-full text-xs">
          <thead className="bg-surface-overlay/50 text-text-tertiary uppercase tracking-[0.1em] text-[10px] sticky top-0">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Waybill</th>
              <th className="text-left px-4 py-2 font-medium">Customer</th>
              <th className="text-left px-4 py-2 font-medium">Suburb</th>
              <th className="text-left px-4 py-2 font-medium">Date</th>
              <th className="text-right px-4 py-2 font-medium">Pcs</th>
              <th className="text-right px-4 py-2 font-medium">Kg</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline/60">
            {ships.map((s: any, i) => (
              <tr key={s.wb || i} className="hover:bg-surface-overlay/30 transition-colors" data-testid={`row-preview-${s.wb || i}`}>
                <td className="px-4 py-2 font-mono text-text-primary">{s.wb}</td>
                <td className="px-4 py-2 text-text-secondary truncate max-w-[200px]">{s.cust || s.acc || "—"}</td>
                <td className="px-4 py-2 text-text-tertiary">{s.dSub || s.cSub || "—"}</td>
                <td className="px-4 py-2 text-text-tertiary">{s.delDate || s.colDate || "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums text-text-secondary">{s.pcs ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums text-text-secondary">{s.kg ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {more > 0 && (
          <div className="px-4 py-2 text-[11px] text-text-tertiary bg-surface-base/40 border-t border-hairline">
            …and {more} more row{more === 1 ? "" : "s"} (showing first 12)
          </div>
        )}
      </div>
      {csvResult.warnings.length > 0 && (
        <div className="px-5 py-3 border-t border-hairline bg-warning/5 text-[11px] text-warning/90 flex items-start gap-2 max-h-32 overflow-y-auto">
          <AlertTriangle className="size-3.5 mt-0.5 flex-shrink-0" />
          <ul className="space-y-1">
            {csvResult.warnings.slice(0, 5).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
            {csvResult.warnings.length > 5 && <li>…and {csvResult.warnings.length - 5} more</li>}
          </ul>
        </div>
      )}
    </Card>
  );
}
