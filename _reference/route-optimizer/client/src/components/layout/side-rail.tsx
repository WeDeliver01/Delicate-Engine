import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Inbox, Activity, Truck, Map, Phone, Archive, BarChart3, ClipboardList, Settings,
  Sun, Moon, Keyboard, Pin, PinOff
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useInspectorStore } from "@/stores/inspector-store";

interface RailItem {
  href: string;
  label: string;
  Icon: LucideIcon;
  match: (path: string) => boolean;
}

const ITEMS: RailItem[] = [
  { href: "/intake", label: "Intake", Icon: Inbox, match: (p) => p.startsWith("/intake") },
  { href: "/live", label: "Live Ops", Icon: Activity, match: (p) => p.startsWith("/live") },
  { href: "/fleet", label: "Fleet", Icon: Truck, match: (p) => p.startsWith("/fleet") },
  { href: "/traffic", label: "Traffic", Icon: Map, match: (p) => p.startsWith("/traffic") },
  { href: "/care", label: "Client Care", Icon: Phone, match: (p) => p.startsWith("/care") },
  { href: "/archive", label: "Archive", Icon: Archive, match: (p) => p.startsWith("/archive") },
  { href: "/insights", label: "Insights", Icon: BarChart3, match: (p) => p.startsWith("/insights") || p.startsWith("/analytics") },
  { href: "/vehicle-logs", label: "Vehicle Logs", Icon: ClipboardList, match: (p) => p.startsWith("/vehicle-logs") },
  { href: "/settings", label: "Settings", Icon: Settings, match: (p) => p.startsWith("/settings") },
];

export function SideRail({
  collapsed,
  onCollapseToggle,
  onShortcuts,
}: {
  collapsed: boolean;
  onCollapseToggle: () => void;
  onShortcuts: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [location] = useLocation();
  const { theme, toggle } = useTheme();
  const expanded = !collapsed && hovered;
  const width = expanded ? 260 : 72;
  const inspectorPinned = useInspectorStore((s) => s.pinned);
  const togglePin = useInspectorStore((s) => s.togglePin);

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width }}
      className="relative flex h-full flex-col border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out"
      data-testid="side-rail"
    >
      <nav className="flex-1 overflow-hidden py-2">
        <ul className="flex flex-col gap-0.5 px-2">
          {ITEMS.map((it) => {
            const active = it.match(location);
            const Icon = it.Icon;
            return (
              <li key={it.href} className="relative">
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full"
                    style={{ background: "hsl(var(--jacaranda-500, 268 60% 55%))" }}
                  />
                )}
                <Link
                  href={it.href}
                  data-testid={`rail-link-${it.label.toLowerCase().replace(/\s+/g, "-")}`}
                  className={`group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <Icon
                    className="h-5 w-5 shrink-0"
                    style={active ? { color: "hsl(var(--jacaranda-400, 268 70% 65%))" } : undefined}
                  />
                  <span
                    className={`whitespace-nowrap font-medium transition-opacity duration-150 ${
                      expanded ? "opacity-100" : "opacity-0 pointer-events-none"
                    }`}
                  >
                    {it.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border/60 p-2 flex flex-col gap-1">
        <button
          onClick={toggle}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors"
          data-testid="rail-theme-toggle"
          title="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-5 w-5 shrink-0" /> : <Moon className="h-5 w-5 shrink-0" />}
          <span className={`whitespace-nowrap transition-opacity ${expanded ? "opacity-100" : "opacity-0"}`}>Theme</span>
        </button>
        <button
          onClick={onShortcuts}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors"
          data-testid="rail-shortcuts"
          title="Keyboard shortcuts"
        >
          <Keyboard className="h-5 w-5 shrink-0" />
          <span className={`whitespace-nowrap transition-opacity ${expanded ? "opacity-100" : "opacity-0"}`}>Shortcuts</span>
        </button>
        <button
          onClick={togglePin}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors"
          data-testid="rail-pin-inspector"
          title={inspectorPinned ? "Unpin inspector" : "Pin inspector"}
        >
          {inspectorPinned ? <PinOff className="h-5 w-5 shrink-0" /> : <Pin className="h-5 w-5 shrink-0" />}
          <span className={`whitespace-nowrap transition-opacity ${expanded ? "opacity-100" : "opacity-0"}`}>
            {inspectorPinned ? "Unpin" : "Pin"} Inspector
          </span>
        </button>
        <button
          onClick={onCollapseToggle}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors"
          data-testid="rail-collapse"
          title="Collapse rail"
        >
          <span className="h-5 w-5 shrink-0 grid place-items-center">⇤</span>
          <span className={`whitespace-nowrap transition-opacity ${expanded ? "opacity-100" : "opacity-0"}`}>Collapse</span>
        </button>
      </div>
    </aside>
  );
}
