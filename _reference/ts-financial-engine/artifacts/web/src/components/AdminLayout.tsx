import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, Store, Map, BookOpen, Link as LinkIcon, DollarSign, Truck, LogOut } from "lucide-react";
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider } from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/driver-balances", label: "Driver Balances", icon: DollarSign },
  { href: "/admin/drivers", label: "Drivers", icon: Users },
  { href: "/admin/bakeries", label: "Bakeries", icon: Store },
  { href: "/admin/zone-rates", label: "Zone Rates", icon: Map },
  { href: "/admin/pricing-rules", label: "Pricing Rules", icon: BookOpen },
  { href: "/admin/assignments", label: "Assignments", icon: LinkIcon },
  { href: "/admin/payouts", label: "Payouts", icon: DollarSign },
  { href: "/admin/deliveries", label: "Deliveries", icon: Truck },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();

  const handleLogout = () => {
    localStorage.removeItem("adminToken");
    setLocation("/admin/login");
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <Sidebar>
          <SidebarHeader className="p-4 border-b">
            <h2 className="text-lg font-bold tracking-tight text-primary font-serif">Delicate Admin</h2>
          </SidebarHeader>
          <SidebarContent>
            <SidebarMenu className="mt-4 px-2">
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton 
                    isActive={location === item.href}
                    onClick={() => setLocation(item.href)}
                    className="w-full justify-start"
                  >
                    <item.icon className="mr-2 h-4 w-4" />
                    {item.label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem className="mt-8">
                <SidebarMenuButton onClick={handleLogout} className="w-full justify-start text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
        <main className="flex-1 flex flex-col min-w-0 bg-muted/30">
          <div className="flex-1 p-6 md:p-8">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
