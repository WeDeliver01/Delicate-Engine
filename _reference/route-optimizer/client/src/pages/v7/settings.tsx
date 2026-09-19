import { Suspense, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDispatchTabBody } from "@/hooks/use-dispatch-data";
import {
  User,
  Wallet,
  Truck,
  Users,
  MapPin,
  Plug,
  Activity,
  Shield,
  Loader2,
} from "lucide-react";
import { ProfilePanel } from "@/components/v7/settings/profile-panel";
import { CostParametersPanel } from "@/components/v7/settings/cost-parameters-panel";
import { DriversPanel, FleetConfigPanel, DepotsPanel } from "@/components/v7/settings/drivers-panel";
import { IntegrationsPanel } from "@/components/v7/settings/integrations-panel";
import { ApiUsagePanel } from "@/components/v7/settings/api-usage-panel";
import { SecurityPanel } from "@/components/v7/settings/security-panel";

interface CategoryDef {
  id: string;
  label: string;
  href: string;
  icon: typeof User;
  render: () => JSX.Element;
}

const CATEGORIES: CategoryDef[] = [
  { id: "profile", label: "Profile", href: "/settings", icon: User, render: () => <ProfilePanel /> },
  { id: "cost", label: "Cost parameters", href: "/settings/cost", icon: Wallet, render: () => <CostParametersPanel /> },
  { id: "fleet", label: "Fleet configuration", href: "/settings/fleet", icon: Truck, render: () => <FleetConfigPanel /> },
  { id: "drivers", label: "Drivers", href: "/settings/drivers", icon: Users, render: () => <DriversPanel /> },
  { id: "depots", label: "Depots", href: "/settings/depots", icon: MapPin, render: () => <DepotsPanel /> },
  { id: "integrations", label: "Integrations", href: "/settings/integrations", icon: Plug, render: () => <IntegrationsPanel /> },
  { id: "api", label: "API usage", href: "/settings/api", icon: Activity, render: () => <ApiUsagePanel /> },
  { id: "security", label: "Security", href: "/settings/security", icon: Shield, render: () => <SecurityPanel /> },
];

function categoryFor(path: string): CategoryDef {
  const tail = path.replace(/^\/settings\/?/, "").split("/")[0] || "profile";
  return CATEGORIES.find((c) => c.id === tail) ?? CATEGORIES[0];
}

function SettingsShell() {
  const [location] = useLocation();
  const active = useMemo(() => categoryFor(location), [location]);

  return (
    <div className="flex flex-1 overflow-hidden" data-testid="v7-settings-shell">
      <aside
        className="w-[240px] shrink-0 border-r border-hairline bg-surface-base/60 px-4 py-8 overflow-y-auto"
        data-testid="v7-settings-rail"
      >
        <p className="mb-4 px-3 text-[10px] uppercase tracking-[0.22em] text-text-quiet">Settings</p>
        <nav className="space-y-0.5">
          {CATEGORIES.map(({ id, label, href, icon: Icon }) => {
            const isActive = id === active.id;
            return (
              <Link
                key={id}
                href={href}
                data-testid={`v7-settings-nav-${id}`}
                className={[
                  "flex items-center gap-3 rounded-md px-3 py-2 text-[13px]",
                  "[transition:background-color_var(--v7-duration-fast)_var(--v7-ease-standard),color_var(--v7-duration-fast)_var(--v7-ease-standard)]",
                  isActive
                    ? "bg-jacaranda-500/15 text-text-primary border-l-2 border-jacaranda-400 -ml-[2px] pl-[14px]"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-raised border-l-2 border-transparent -ml-[2px] pl-[14px]",
                ].join(" ")}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-5xl px-10 py-10" data-testid={`v7-settings-panel-${active.id}`}>
          <Suspense fallback={<div className="text-text-secondary text-sm flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div>}>
            {active.render()}
          </Suspense>
        </div>
      </ScrollArea>
    </div>
  );
}

export default function SettingsPage() {
  const [location] = useLocation();
  const auditBody = useDispatchTabBody("log");
  if (location.startsWith("/settings/audit")) return <>{auditBody}</>;
  return <SettingsShell />;
}
