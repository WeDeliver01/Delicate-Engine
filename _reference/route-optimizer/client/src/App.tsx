import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { SidebarProvider } from "@/components/ui/sidebar";
import { lazy, Suspense, type ComponentType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/layout/AppShell";
import DispatchPage from "@/pages/dispatch";

// Lazy-loaded route chunks are hash-named. After a new deploy the old hash no
// longer exists on the server, so an open tab fetching an old chunk fails with
// "Failed to fetch dynamically imported module". Auto-recover by reloading the
// page ONCE (guarded by sessionStorage so a genuinely-broken chunk can't loop)
// to pick up the fresh index.html + chunk names.
const LAZY_RETRY_KEY = "lazy-retry-refreshed";
function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await factory();
      window.sessionStorage.removeItem(LAZY_RETRY_KEY);
      return mod;
    } catch (error) {
      const alreadyRefreshed =
        window.sessionStorage.getItem(LAZY_RETRY_KEY) === "true";
      if (!alreadyRefreshed) {
        window.sessionStorage.setItem(LAZY_RETRY_KEY, "true");
        window.location.reload();
        // Never resolve; the page is reloading.
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}

const DesignPage = lazyWithRetry(() => import("@/pages/design"));
const DriverLogin = lazyWithRetry(() => import("@/pages/driver-login"));
const DriverDashboard = lazyWithRetry(() => import("@/pages/driver-dashboard"));
const DriverRouteOverview = lazyWithRetry(() => import("@/pages/driver-route-overview"));
const DriverTripSummary = lazyWithRetry(() => import("@/pages/driver-trip-summary"));
const DriverAnalyticsSelf = lazyWithRetry(() => import("@/pages/driver-analytics-self"));
const DriverInstall = lazyWithRetry(() => import("@/pages/driver-install"));

const IntakePage = lazyWithRetry(() => import("@/pages/v7/intake"));
const LiveOpsPage = lazyWithRetry(() => import("@/pages/v7/live-ops"));
const FleetPage = lazyWithRetry(() => import("@/pages/v7/fleet"));
const TrafficPage = lazyWithRetry(() => import("@/pages/v7/traffic"));
const ClientCarePage = lazyWithRetry(() => import("@/pages/v7/client-care"));
const ArchivePage = lazyWithRetry(() => import("@/pages/v7/archive"));
const InsightsPage = lazyWithRetry(() => import("@/pages/v7/insights"));
const SettingsPage = lazyWithRetry(() => import("@/pages/v7/settings"));
const VehicleLogsPage = lazyWithRetry(() => import("@/pages/v7/vehicle-logs"));

function DriverFallback() {
  return (
    <div className="h-screen flex items-center justify-center" style={{ background: "#1a1a2e" }}>
      <div className="w-8 h-8 border-2 border-[#4a9eff] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function AuthLoading() {
  return (
    <div className="h-screen flex items-center justify-center bg-[#1a1a2e]">
      <div className="w-8 h-8 border-2 border-[#4a9eff] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  role: string;
  avatarColor: string;
}

interface AuthShellProps {
  user: AuthUser;
  logout: () => void;
  updateProfile: (data: Partial<AuthUser>) => Promise<unknown>;
}

function AuthedRoutes() {
  const [location] = useLocation();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="contents"
      >
        <Suspense fallback={null}>
          <Switch location={location}>
            <Route path="/" component={() => <Redirect to="/live" />} />
            <Route path="/intake" component={IntakePage} />
            <Route path="/live/:rest*" component={LiveOpsPage} />
            <Route path="/live" component={LiveOpsPage} />
            <Route path="/fleet" component={FleetPage} />
            <Route path="/traffic" component={TrafficPage} />
            <Route path="/care" component={ClientCarePage} />
            <Route path="/archive/:rest*" component={ArchivePage} />
            <Route path="/archive" component={ArchivePage} />
            <Route path="/insights/:rest*" component={InsightsPage} />
            <Route path="/insights" component={InsightsPage} />
            <Route path="/analytics" component={InsightsPage} />
            <Route path="/vehicle-logs" component={VehicleLogsPage} />
            <Route path="/settings/:rest*" component={SettingsPage} />
            <Route path="/settings" component={SettingsPage} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}

function AuthedShell({ user, logout, updateProfile }: AuthShellProps) {
  return (
    <AppShell authUser={user} onLogout={logout}>
      <DispatchPage chrome="v7" authUser={user} onLogout={logout} onUpdateProfile={updateProfile}>
        <AuthedRoutes />
      </DispatchPage>
    </AppShell>
  );
}

function Router() {
  const { user, loading, login, register, logout, updateProfile } = useAuth();

  if (loading) {
    return <AuthLoading />;
  }

  return (
    <Switch>
      <Route path="/design">{() => <Suspense fallback={<DriverFallback />}><DesignPage /></Suspense>}</Route>
      <Route path="/driver/login">{() => <Suspense fallback={<DriverFallback />}><DriverLogin /></Suspense>}</Route>
      <Route path="/driver/dashboard">{() => <Suspense fallback={<DriverFallback />}><DriverDashboard /></Suspense>}</Route>
      <Route path="/driver/route">{() => <Suspense fallback={<DriverFallback />}><DriverRouteOverview /></Suspense>}</Route>
      <Route path="/driver/summary">{() => <Suspense fallback={<DriverFallback />}><DriverTripSummary /></Suspense>}</Route>
      <Route path="/driver/analytics">{() => <Suspense fallback={<DriverFallback />}><DriverAnalyticsSelf /></Suspense>}</Route>
      <Route path="/driver/install">{() => <Suspense fallback={<DriverFallback />}><DriverInstall /></Suspense>}</Route>
      <Route>
        {() =>
          user ? (
            <AuthedShell user={user} logout={logout} updateProfile={updateProfile} />
          ) : (
            <AuthPage onAuth={() => {}} login={login} register={register} />
          )
        }
      </Route>
    </Switch>
  );
}

const sidebarStyle = {
  "--sidebar-width": "14rem",
  "--sidebar-width-icon": "3rem",
};

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <SidebarProvider style={sidebarStyle as React.CSSProperties}>
              <div className="flex h-screen w-full">
                <Toaster />
                <Router />
              </div>
            </SidebarProvider>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
