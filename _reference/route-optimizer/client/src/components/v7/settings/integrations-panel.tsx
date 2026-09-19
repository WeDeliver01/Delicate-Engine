import { AddressBookManager, WebhookSettingsManager, DriverAccountsManager } from "@/pages/dispatch";
import { useDispatchExtras } from "@/hooks/use-dispatch-data";
import { PanelHeader } from "./profile-panel";

export function IntegrationsPanel() {
  const { fleetSettings } = useDispatchExtras();
  return (
    <div className="space-y-6" data-testid="v7-settings-integrations">
      <PanelHeader
        title="Integrations"
        subtitle="ShipLogic webhook, client account directory, and driver app login accounts."
      />
      <WebhookSettingsManager />
      <AddressBookManager />
      <DriverAccountsManager fleetSettings={fleetSettings} />
    </div>
  );
}
