import { MetricCard } from "@/components/ui/metric-card";
import { Package, Clock, FileWarning, Database } from "lucide-react";
import { useIntakeContext } from "@/hooks/use-dispatch-data";

export function IntakeSummaryStrip() {
  const { csvResult, totalShipmentsLoaded, estimatedDriveHours } = useIntakeContext();
  const incoming = csvResult?.ships.length ?? 0;
  const warnings = csvResult?.warnings.length ?? 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <MetricCard
        label="Incoming Rows"
        value={incoming}
        icon={<Package className="size-4" />}
        tone={incoming > 0 ? "brand" : "neutral"}
        data-testid="metric-incoming-rows"
      />
      <MetricCard
        label="Currently Loaded"
        value={totalShipmentsLoaded}
        icon={<Database className="size-4" />}
        data-testid="metric-loaded-shipments"
      />
      <MetricCard
        label="Est. Drive Hours"
        value={estimatedDriveHours}
        unit="h"
        icon={<Clock className="size-4" />}
        data-testid="metric-drive-hours"
      />
      <MetricCard
        label="Parse Warnings"
        value={warnings}
        icon={<FileWarning className="size-4" />}
        tone={warnings > 0 ? "warning" : "neutral"}
        data-testid="metric-warnings"
      />
    </div>
  );
}
