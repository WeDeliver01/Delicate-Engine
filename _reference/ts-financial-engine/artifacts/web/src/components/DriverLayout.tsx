import { useLocation } from "wouter";
import { Wallet, Truck, Book, DollarSign, LogOut } from "lucide-react";
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider } from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { href: "/driver/wallet", label: "Wallet", icon: Wallet },
  { href: "/driver/deliveries", label: "Deliveries", icon: Truck },
  { href: "/driver/ledger", label: "Ledger", icon: Book },
  { href: "/driver/payouts", label: "Payouts", icon: DollarSign },
];

export function DriverLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();

  const handleLogout = () => {
    localStorage.removeItem("driverToken");
    setLocation("/driver/login");
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <Sidebar>
          <SidebarHeader className="p-4 border-b">
            <h2 className="text-lg font-bold tracking-tight text-primary font-serif">Driver Portal</h2>
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
