import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Upload, Sparkles, Loader2, Download, FolderOpen, Trash2 } from "lucide-react";
import { useIntakeContext } from "@/hooks/use-dispatch-data";
import { IntakeSourceTabs } from "@/components/v7/intake-source-tabs";
import { IntakePreview } from "@/components/v7/intake-preview";
import { IntakeSummaryStrip } from "@/components/v7/intake-summary-strip";

export default function IntakePage() {
  const intake = useIntakeContext();
  const [dragOver, setDragOver] = useState(false);
  const localFileRef = useRef<HTMLInputElement>(null);

  const fileInput = intake.fileRef ?? localFileRef;
  const hasPreview = (intake.csvResult?.ships.length ?? 0) > 0;
  const busy = intake.optimizing || intake.geocoding;

  const dropZone = (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { setDragOver(false); intake.handleFileDrop(e); }}
      className={`relative rounded-[var(--v7-radius-lg)] border-2 border-dashed transition-all p-10 text-center cursor-pointer ${
        dragOver
          ? "border-jacaranda-400 bg-jacaranda-500/10"
          : "border-hairline bg-surface-base/40 hover:bg-surface-overlay/30"
      }`}
      onClick={() => fileInput.current?.click()}
      data-testid="intake-dropzone"
    >
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) intake.readFile(f); }}
        data-testid="input-csv-file"
      />
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-jacaranda-500/15 text-jacaranda-200 mb-4">
        <Upload className="size-6" />
      </div>
      <h3 className="font-display text-xl font-medium text-text-primary tracking-tight">
        Drop a ShipLogic CSV
      </h3>
      <p className="text-sm text-text-tertiary mt-1.5 max-w-sm mx-auto leading-relaxed">
        Drag &amp; drop or click to browse. Files are parsed locally and merged with any pending webhook arrivals.
      </p>
      {intake.csvFileName && (
        <div className="mt-4 inline-flex items-center gap-2">
          <StatusPill tone="success" size="sm" dot>{intake.csvFileName}</StatusPill>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-quiet">Stage 01</p>
            <h1 className="font-display text-4xl font-medium text-text-primary tracking-tight mt-1">Intake</h1>
            <p className="text-sm text-text-tertiary mt-1.5 max-w-xl leading-relaxed">
              Bring shipments in from a CSV, paste, or the live ShipLogic webhook. Preview before you commit.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              ref={intake.importFileRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={intake.handleImportProject}
              data-testid="input-import-project"
            />
            <Button variant="outline" size="sm" onClick={() => intake.importFileRef.current?.click()} data-testid="button-import-project">
              <FolderOpen className="size-3.5 mr-1.5" /> Restore Project
            </Button>
            <Button variant="outline" size="sm" onClick={intake.handleExport} data-testid="button-export-project">
              <Download className="size-3.5 mr-1.5" /> Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-red-500/40 text-red-300 hover:bg-red-500/10 hover:text-red-200"
              data-testid="button-wipe-csv"
              onClick={async () => {
                if (!window.confirm("Wipe all CSV-imported shipments from every project? Webhook (ShipLogic) shipments are preserved. Cannot be undone.")) return;
                try {
                  const resp = await fetch("/api/dispatch/wipe-shipments", { method: "POST", credentials: "include" });
                  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                  const data = await resp.json();
                  alert(`Wiped ${data.shipmentsRemoved} CSV shipments. Kept ${data.shipmentsKept} webhook shipments across ${data.projectsTouched} project(s).`);
                  window.location.reload();
                } catch (e: any) {
                  alert(`Wipe failed: ${e.message}`);
                }
              }}
            >
              <Trash2 className="size-3.5 mr-1.5" /> Wipe CSV
            </Button>
          </div>
        </header>

        <IntakeSummaryStrip />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <Card grain className="lg:col-span-3 p-5 space-y-5">
            <IntakeSourceTabs dropZone={dropZone} />
          </Card>
          <div className="lg:col-span-2">
            <IntakePreview />
          </div>
        </div>

        <div className="sticky bottom-4 z-10">
          <Card grain className="flex items-center justify-between gap-4 px-5 py-4 shadow-v7-md">
            <div className="flex items-center gap-3">
              {hasPreview ? (
                <>
                  <StatusPill tone="brand" size="sm" dot>Ready</StatusPill>
                  <span className="text-sm text-text-secondary">
                    {intake.csvResult!.ships.length} shipment{intake.csvResult!.ships.length === 1 ? "" : "s"} ready to confirm
                  </span>
                </>
              ) : (
                <>
                  <StatusPill tone="neutral" size="sm">Awaiting source</StatusPill>
                  <span className="text-sm text-text-tertiary">Drop a file or paste CSV to enable confirmation.</span>
                </>
              )}
              {intake.geocoding && intake.geocodingProgress && (
                <span className="text-xs text-text-tertiary">
                  Geocoding {intake.geocodingProgress.done}/{intake.geocodingProgress.total}…
                </span>
              )}
            </div>
            <Button
              size="lg"
              onClick={() => intake.confirmIntake()}
              disabled={!hasPreview || busy}
              className="bg-jacaranda-gradient text-white hover:opacity-90 shadow-v7-sm border-0 px-6"
              data-testid="button-confirm-intake"
            >
              {busy ? (
                <><Loader2 className="size-4 mr-2 animate-spin" /> Working…</>
              ) : (
                <><Sparkles className="size-4 mr-2" /> Confirm Intake</>
              )}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
