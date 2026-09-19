import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Pin } from "lucide-react";
import type { Shipment, DeliveryOverride, CollectionOverride } from "@shared/schema";

export type StopOverrideKind = "C" | "D";
export type StopOverrideValue = {
  after?: string;
  before?: string;
  pinnedTime?: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shipment: Shipment | null;
  kind?: StopOverrideKind;
  currentOverride?: DeliveryOverride | CollectionOverride;
  /**
   * Back-compat signature for delivery-window dialog (id, dAfter, dBefore).
   * When `pinnedTime` is set, dAfter/dBefore can be empty strings and the
   * caller should treat the third argument as pinned-only.
   */
  onSave: (shipmentId: string, after: string, before: string, pinnedTime?: string) => void;
  onClear: (shipmentId: string) => void;
}

export function DeliveryWindowDialog({
  open,
  onOpenChange,
  shipment,
  kind = "D",
  currentOverride,
  onSave,
  onClear,
}: Props) {
  const { toast } = useToast();
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [pinned, setPinned] = useState("");
  const [tab, setTab] = useState<"window" | "pinned">("window");

  useEffect(() => {
    if (!shipment) return;
    if (kind === "D") {
      setAfter(shipment.dAfter || "08:00");
      setBefore(shipment.dBefore || "17:00");
    } else {
      setAfter(shipment.cAfter || "08:00");
      setBefore(shipment.cBefore || "17:00");
    }
    const existingPin = (currentOverride as any)?.pinnedTime as string | undefined;
    setPinned(existingPin || (kind === "D" ? (shipment.dAfter || "10:00") : (shipment.cAfter || "10:00")));
    setTab(existingPin ? "pinned" : "window");
  }, [shipment, kind, currentOverride, open]);

  if (!shipment) return null;

  const origAfter = kind === "D"
    ? (shipment.origDAfter || shipment.dAfter || "—")
    : (shipment.origCAfter || shipment.cAfter || "—");
  const origBefore = kind === "D"
    ? (shipment.origDBefore || shipment.dBefore || "—")
    : (shipment.origCBefore || shipment.cBefore || "—");
  const sub = kind === "D" ? (shipment.dSub || shipment.dCity) : (shipment.cSub || shipment.cCity);
  const label = kind === "D" ? "delivery" : "collection";
  const verb = kind === "D" ? "Deliver" : "Collect";

  function parseStrict(s: string, isEnd: boolean): number | null {
    if (!/^\d{2}:\d{2}$/.test(s)) return null;
    const [hStr, mStr] = s.split(":");
    const h = Number(hStr); const m = Number(mStr);
    if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
    if (m < 0 || m > 59) return null;
    if (h === 24) return isEnd && m === 0 ? 24 * 60 : null;
    if (h < 0 || h > 23) return null;
    return h * 60 + m;
  }

  function handleSave() {
    if (!shipment) return;
    if (tab === "pinned") {
      const p = parseStrict(pinned, false);
      if (p == null) {
        toast({ title: "Invalid pinned time", description: "Use HH:MM (00:00–23:59).", variant: "destructive" });
        return;
      }
      onSave(shipment.id, "", "", pinned);
      onOpenChange(false);
      return;
    }
    const a = parseStrict(after, false);
    const b = parseStrict(before, true);
    if (a == null) {
      toast({ title: "Invalid start time", description: "Use HH:MM (00:00–23:59).", variant: "destructive" });
      return;
    }
    if (b == null) {
      toast({ title: "Invalid end time", description: "Use HH:MM (00:00–23:59, or 24:00 for end of day).", variant: "destructive" });
      return;
    }
    if (a >= b) {
      toast({ title: "Invalid window", description: `${verb} start must be before end.`, variant: "destructive" });
      return;
    }
    onSave(shipment.id, after, before);
    onOpenChange(false);
  }

  function handleClear() {
    if (!shipment) return;
    onClear(shipment.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid={`dialog-${label}-window`}>
        <DialogHeader>
          <DialogTitle>Override {label} time</DialogTitle>
          <DialogDescription>
            Waybill <span className="font-mono">{shipment.wb}</span> — {sub}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            Requested by sender:
            <Badge variant="outline" className="font-mono">{origAfter}–{origBefore}</Badge>
            {currentOverride && (
              <Badge variant="secondary" className="text-[10px]">
                {(currentOverride as any).pinnedTime ? <><Pin className="size-2.5 mr-1 inline" />Pinned</> : "Overridden"}
              </Badge>
            )}
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "window" | "pinned")}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="window" data-testid={`tab-window-${label}`}>Window</TabsTrigger>
              <TabsTrigger value="pinned" data-testid={`tab-pinned-${label}`}>
                <Pin className="size-3 mr-1" /> Target time
              </TabsTrigger>
            </TabsList>

            <TabsContent value="window" className="space-y-3 pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`${label}-after`}>{verb} after</Label>
                  <Input
                    id={`${label}-after`}
                    type="time"
                    value={after}
                    onChange={(e) => setAfter(e.target.value)}
                    data-testid={`input-${label}-after`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${label}-before`}>{verb} before</Label>
                  <Input
                    id={`${label}-before`}
                    type="time"
                    value={before}
                    onChange={(e) => setBefore(e.target.value)}
                    data-testid={`input-${label}-before`}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]"
                  onClick={() => { setAfter("00:00"); setBefore(before || "17:00"); }}
                  data-testid={`button-${label}-quickset-asap`}>
                  As early as possible
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]"
                  onClick={() => { setAfter("08:00"); setBefore("12:00"); }}
                  data-testid={`button-${label}-quickset-morning`}>
                  Morning (08:00–12:00)
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]"
                  onClick={() => { setAfter("13:00"); setBefore("17:00"); }}
                  data-testid={`button-${label}-quickset-afternoon`}>
                  Afternoon (13:00–17:00)
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="pinned" className="space-y-3 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${label}-pinned`} className="flex items-center gap-1.5">
                  <Pin className="size-3" /> Pin target arrival time
                </Label>
                <Input
                  id={`${label}-pinned`}
                  type="time"
                  value={pinned}
                  onChange={(e) => setPinned(e.target.value)}
                  data-testid={`input-${label}-pinned`}
                />
                <p className="text-[11px] text-muted-foreground">
                  The optimizer will try to land at this exact minute. Late penalties apply if the trip can't make it.
                </p>
              </div>
            </TabsContent>
          </Tabs>

          <p className="text-[11px] text-muted-foreground">
            Saving re-runs the optimizer so the trip plan reflects the new {label} time.
            {kind === "D" ? " Collection windows are unaffected." : " Delivery windows are unaffected."}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {currentOverride && (
            <Button variant="outline" onClick={handleClear} data-testid={`button-clear-${label}-override`}>
              Clear override
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid={`button-cancel-${label}-override`}>
            Cancel
          </Button>
          <Button onClick={handleSave} data-testid={`button-save-${label}-override`}>
            Save &amp; re-optimize
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
