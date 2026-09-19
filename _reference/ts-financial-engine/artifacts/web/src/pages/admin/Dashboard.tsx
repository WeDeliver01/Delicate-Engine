import { useQueryClient } from "@tanstack/react-query";
import { useGetAdminOverview, useGetAdminActivity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatZAR, formatBps } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: overview, isLoading: isLoadingOverview } = useGetAdminOverview();
  const { data: activity, isLoading: isLoadingActivity } = useGetAdminActivity();

  if (isLoadingOverview || isLoadingActivity) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-serif font-bold text-primary">Command Center</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-serif font-bold text-primary">Command Center</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatZAR(overview?.totalRevenueCents)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Driver Payouts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatZAR(overview?.totalDriverPayoutCents)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fuel Costs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatZAR(overview?.totalFuelCents)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Est. Margin</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatBps(overview?.marginBps)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-serif">Recent Deliveries</CardTitle>
          </CardHeader>
          <CardContent>
            {activity?.deliveries.length === 0 ? (
              <div className="text-muted-foreground text-sm text-center py-8">No recent deliveries</div>
            ) : (
              <div className="space-y-4">
                {activity?.deliveries.slice(0, 5).map(delivery => (
                  <div key={delivery.id} className="flex justify-between items-center border-b pb-4 last:border-0 last:pb-0">
                    <div>
                      <div className="font-medium text-sm">Delivery to {delivery.zone || 'Unknown Zone'}</div>
                      <div className="text-xs text-muted-foreground">{new Date(delivery.createdAt || '').toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-sm">{formatZAR(delivery.priceCents)}</div>
                      <div className="text-xs text-muted-foreground">Margin: {formatBps(delivery.marginBps)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-serif">Pending Payouts</CardTitle>
          </CardHeader>
          <CardContent>
            {activity?.payouts.length === 0 ? (
              <div className="text-muted-foreground text-sm text-center py-8">No pending payouts</div>
            ) : (
              <div className="space-y-4">
                {activity?.payouts.slice(0, 5).map(payout => (
                  <div key={payout.id} className="flex justify-between items-center border-b pb-4 last:border-0 last:pb-0">
                    <div>
                      <div className="font-medium text-sm">Payout Request</div>
                      <div className="text-xs text-muted-foreground">{new Date(payout.createdAt || '').toLocaleString()}</div>
                    </div>
                    <div className="font-bold text-sm">{formatZAR(payout.amountCents)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
