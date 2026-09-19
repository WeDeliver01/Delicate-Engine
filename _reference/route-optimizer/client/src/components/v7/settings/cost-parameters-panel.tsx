import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useDispatchExtras } from "@/hooks/use-dispatch-data";
import { PanelHeader } from "./profile-panel";

export function CostParametersPanel() {
  const { fleetSettings, setFleetSettings, log } = useDispatchExtras();
  const { toast } = useToast();
  const [fuelPrice, setFuelPrice] = useState(String(fleetSettings.fuelPrice));
  const [cityFactor, setCityFactor] = useState(String(fleetSettings.cityFactor));

  useEffect(() => { setFuelPrice(String(fleetSettings.fuelPrice)); }, [fleetSettings.fuelPrice]);
  useEffect(() => { setCityFactor(String(fleetSettings.cityFactor)); }, [fleetSettings.cityFactor]);

  function save() {
    const fp = parseFloat(fuelPrice);
    const cf = parseFloat(cityFactor);
    if (isNaN(fp) || fp <= 0) { toast({ title: "Invalid fuel price", variant: "destructive" }); return; }
    if (isNaN(cf) || cf <= 0) { toast({ title: "Invalid city factor", variant: "destructive" }); return; }
    setFleetSettings({ ...fleetSettings, fuelPrice: fp, cityFactor: cf });
    log(`Updated fuel price to R${fp}/L, city factor to ${cf}x`, "SYS");
    toast({ title: "Cost parameters saved", description: `Fuel: R${fp}/L · City factor: ${cf}x` });
  }

  return (
    <div className="space-y-6" data-testid="v7-settings-cost-parameters">
      <PanelHeader
        title="Cost parameters"
        subtitle="Drives every per-kilometre cost calculation across the fleet."
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <Input label="Fuel price (R / litre)" type="number" step="0.01" min="0" value={fuelPrice} onChange={(e) => setFuelPrice(e.target.value)} className="font-mono" data-testid="v7-input-fuel-price" />
        <Input label="City delivery factor" type="number" step="0.01" min="1" value={cityFactor} onChange={(e) => setCityFactor(e.target.value)} className="font-mono" data-testid="v7-input-city-factor" />
      </div>
      <p className="text-[12px] text-text-secondary">
        Cost/km is calculated as <span className="font-mono">(L/100km × city factor / 100) × fuel price</span>.
      </p>
      <div className="flex justify-end">
        <Button variant="primary" onClick={save} data-testid="v7-button-save-costs">
          <Save className="size-3.5" /> Save parameters
        </Button>
      </div>
    </div>
  );
}
