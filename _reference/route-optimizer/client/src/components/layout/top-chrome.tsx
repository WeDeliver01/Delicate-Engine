import { Search, Bell, Power } from "lucide-react";
import { useLiveClock } from "@/hooks/use-live-clock";
import { DriverMapButton } from "@/components/dispatcher-driver-map";

interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  role: string;
  avatarColor: string;
}

export function TopChrome({
  authUser,
  onLogout,
  onOpenPalette,
  systemOk = true,
  notifications = 0,
}: {
  authUser?: AuthUser;
  onLogout?: () => void;
  onOpenPalette: () => void;
  systemOk?: boolean;
  notifications?: number;
}) {
  const { time, date } = useLiveClock();
  const initial = (authUser?.displayName || authUser?.username || "?").charAt(0).toUpperCase();

  return (
    <header
      className="flex items-center gap-3 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      style={{ height: 48 }}
      data-testid="top-chrome"
    >
      <div className="flex items-center gap-2.5 pr-2">
        <img
          src="/favicon.png?v=3"
          alt="Delicate Routes"
          width={28}
          height={28}
          className="rounded-md bg-white object-contain"
          data-testid="img-top-chrome-logo"
        />
        <span className="hidden sm:inline text-[15px] font-semibold tracking-tight" style={{ fontFamily: "Fraunces, ui-serif, serif" }}>
          Delicate Courier
        </span>
      </div>

      <div className="flex-1 flex justify-center">
        <button
          onClick={onOpenPalette}
          className="group flex w-full max-w-[520px] items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/70 transition-colors"
          data-testid="button-open-palette"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Search pages, drivers, waybills…</span>
          <kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">⌘K</kbd>
        </button>
      </div>

      <div className="flex items-center gap-3 pl-2">
        <span className="hidden md:flex items-center gap-1 text-[12px] font-mono tabular-nums text-muted-foreground" data-testid="top-chrome-clock">
          <span>{date}</span>
          <span>·</span>
          <span className="text-foreground/80">{time}</span>
        </span>
        <span
          className={`h-2.5 w-2.5 rounded-full ${systemOk ? "bg-emerald-500" : "bg-red-500"}`}
          title={systemOk ? "Systems nominal" : "System issue"}
          data-testid="status-system"
        />
        {authUser && <DriverMapButton />}
        <button
          className="relative rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          data-testid="button-notifications"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {notifications > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full bg-red-500 px-1 text-[9px] font-bold text-white grid place-items-center">
              {notifications}
            </span>
          )}
        </button>
        {authUser && (
          <div className="flex items-center gap-2">
            <div
              className="grid h-8 w-8 place-items-center rounded-full text-[12px] font-bold text-white ring-2"
              style={{ background: authUser.avatarColor, "--tw-ring-color": authUser.avatarColor } as React.CSSProperties}
              data-testid="top-chrome-avatar"
              title={authUser.displayName || authUser.username}
            >
              {initial}
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                data-testid="button-logout"
                title="Sign out"
              >
                <Power className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
