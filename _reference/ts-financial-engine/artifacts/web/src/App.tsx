import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import NotFound from "@/pages/not-found";

// Layouts
import { AdminLayout } from "@/components/AdminLayout";
import { DriverLayout } from "@/components/DriverLayout";

// Admin Pages
import AdminLogin from "@/pages/admin/Login";
import AdminDashboard from "@/pages/admin/Dashboard";
import AdminDriverBalances from "@/pages/admin/DriverBalances";
import AdminDrivers from "@/pages/admin/Drivers";
import AdminBakeries from "@/pages/admin/Bakeries";
import AdminZoneRates from "@/pages/admin/ZoneRates";
import AdminPricingRules from "@/pages/admin/PricingRules";
import AdminAssignments from "@/pages/admin/Assignments";
import AdminPayouts from "@/pages/admin/Payouts";
import AdminDeliveries from "@/pages/admin/Deliveries";

// Driver Pages
import DriverLogin from "@/pages/driver/Login";
import DriverWallet from "@/pages/driver/Wallet";
import DriverDeliveries from "@/pages/driver/Deliveries";
import DriverLedger from "@/pages/driver/Ledger";
import DriverPayouts from "@/pages/driver/Payouts";

const queryClient = new QueryClient();

// Route Guards
function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const [, setLocation] = useLocation();
  const token = localStorage.getItem("adminToken");

  useEffect(() => {
    if (!token) {
      setLocation("/admin/login");
    }
  }, [token, setLocation]);

  if (!token) return null;

  return (
    <AdminLayout>
      <Component />
    </AdminLayout>
  );
}

function DriverRoute({ component: Component }: { component: React.ComponentType }) {
  const [, setLocation] = useLocation();
  const token = localStorage.getItem("driverToken");

  useEffect(() => {
    if (!token) {
      setLocation("/driver/login");
    }
  }, [token, setLocation]);

  if (!token) return null;

  return (
    <DriverLayout>
      <Component />
    </DriverLayout>
  );
}

function RedirectToLogin() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/admin/login");
  }, [setLocation]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={RedirectToLogin} />
      
      {/* Admin Routes */}
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/admin/dashboard">
        {() => <AdminRoute component={AdminDashboard} />}
      </Route>
      <Route path="/admin/driver-balances">
        {() => <AdminRoute component={AdminDriverBalances} />}
      </Route>
      <Route path="/admin/drivers">
        {() => <AdminRoute component={AdminDrivers} />}
      </Route>
      <Route path="/admin/bakeries">
        {() => <AdminRoute component={AdminBakeries} />}
      </Route>
      <Route path="/admin/zone-rates">
        {() => <AdminRoute component={AdminZoneRates} />}
      </Route>
      <Route path="/admin/pricing-rules">
        {() => <AdminRoute component={AdminPricingRules} />}
      </Route>
      <Route path="/admin/assignments">
        {() => <AdminRoute component={AdminAssignments} />}
      </Route>
      <Route path="/admin/payouts">
        {() => <AdminRoute component={AdminPayouts} />}
      </Route>
      <Route path="/admin/deliveries">
        {() => <AdminRoute component={AdminDeliveries} />}
      </Route>

      {/* Driver Routes */}
      <Route path="/driver/login" component={DriverLogin} />
      <Route path="/driver/wallet">
        {() => <DriverRoute component={DriverWallet} />}
      </Route>
      <Route path="/driver/deliveries">
        {() => <DriverRoute component={DriverDeliveries} />}
      </Route>
      <Route path="/driver/ledger">
        {() => <DriverRoute component={DriverLedger} />}
      </Route>
      <Route path="/driver/payouts">
        {() => <DriverRoute component={DriverPayouts} />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
