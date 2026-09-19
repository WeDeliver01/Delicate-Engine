import { useState, useEffect, useCallback } from "react";
import { TopChrome } from "./top-chrome";
import { SideRail } from "./side-rail";
import { CommandPalette } from "@/components/command-palette";
import { useToast } from "@/hooks/use-toast";
import jacarandaBg from "@/assets/jacaranda-bg.png";

interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  role: string;
  avatarColor: string;
}

export function AppShell({
  authUser,
  onLogout,
  children,
}: {
  authUser?: AuthUser;
  onLogout?: () => void;
  children: React.ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const showShortcuts = useCallback(() => {
    toast({
      title: "Keyboard shortcuts",
      description: "⌘K open palette · b toggle sidebar · esc close panels",
    });
  }, [toast]);

  return (
    <div className="relative flex h-screen w-full flex-col text-foreground" data-testid="app-shell">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-cover bg-center bg-fixed opacity-90 dark:opacity-70"
        style={{ backgroundImage: `url(${jacarandaBg})` }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--v7-surface-base) / 0.30) 0%, hsl(var(--v7-surface-base) / 0.55) 60%, hsl(var(--v7-surface-inset) / 0.75) 100%)",
        }}
      />
      <TopChrome
        authUser={authUser}
        onLogout={onLogout}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <div className="flex flex-1 overflow-hidden">
        <SideRail
          collapsed={collapsed}
          onCollapseToggle={() => setCollapsed((v) => !v)}
          onShortcuts={showShortcuts}
        />
        <div className="flex-1 overflow-hidden flex flex-row min-w-0" data-testid="app-shell-main">
          {children}
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
