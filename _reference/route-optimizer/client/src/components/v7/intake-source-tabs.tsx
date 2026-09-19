import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ui/status-pill";
import { Upload, ClipboardPaste, Webhook, FileSpreadsheet, ExternalLink } from "lucide-react";
import { useIntakeContext } from "@/hooks/use-dispatch-data";
import type { ReactNode } from "react";

interface Props {
  dropZone: ReactNode;
}

export function IntakeSourceTabs({ dropZone }: Props) {
  const intake = useIntakeContext();

  return (
    <Tabs defaultValue="drop" className="w-full">
      <TabsList className="grid w-full grid-cols-3 bg-surface-overlay/40 border border-hairline rounded-[var(--v7-radius-md)] p-1 h-auto">
        <TabsTrigger value="drop" className="gap-2 data-[state=active]:bg-surface-raised data-[state=active]:text-text-primary text-text-tertiary" data-testid="tab-source-drop">
          <Upload className="size-3.5" /> Drop File
        </TabsTrigger>
        <TabsTrigger value="paste" className="gap-2 data-[state=active]:bg-surface-raised data-[state=active]:text-text-primary text-text-tertiary" data-testid="tab-source-paste">
          <ClipboardPaste className="size-3.5" /> Paste CSV
        </TabsTrigger>
        <TabsTrigger value="webhook" className="gap-2 data-[state=active]:bg-surface-raised data-[state=active]:text-text-primary text-text-tertiary" data-testid="tab-source-webhook">
          <Webhook className="size-3.5" /> ShipLogic
        </TabsTrigger>
      </TabsList>

      <TabsContent value="drop" className="mt-4">
        {dropZone}
      </TabsContent>

      <TabsContent value="paste" className="mt-4 space-y-3">
        <Textarea
          value={intake.csvText}
          onChange={(e) => intake.setCsvText(e.target.value)}
          placeholder="Paste ShipLogic CSV rows here…"
          rows={10}
          className="font-mono text-xs bg-surface-base/60 border-hairline"
          data-testid="textarea-paste-csv"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => intake.setCsvText("")} disabled={!intake.csvText} data-testid="button-clear-csv">
            Clear
          </Button>
          <Button size="sm" onClick={() => intake.parsePastedCsv()} disabled={!intake.csvText.trim()} data-testid="button-parse-csv">
            <FileSpreadsheet className="size-3.5 mr-1.5" /> Parse Preview
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="webhook" className="mt-4">
        <div className="rounded-[var(--v7-radius-md)] border border-hairline bg-surface-base/40 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <StatusPill tone="brand" size="sm" dot>Live</StatusPill>
            <span className="text-sm text-text-secondary">ShipLogic webhook is configured server-side.</span>
          </div>
          <p className="text-xs text-text-tertiary leading-relaxed">
            New shipments arriving via the ShipLogic webhook are merged automatically with this intake on confirm.
            Configure the endpoint URL and authentication in Settings.
          </p>
          <Button variant="outline" size="sm" onClick={intake.goToWebhookSettings} data-testid="button-webhook-settings">
            Open ShipLogic Settings <ExternalLink className="size-3.5 ml-1.5" />
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}
