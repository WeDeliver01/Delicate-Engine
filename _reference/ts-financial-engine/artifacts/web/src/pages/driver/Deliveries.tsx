import { useGetDriverDeliveries } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatZAR } from "@/lib/formatters";

export default function Deliveries() {
  const { data: deliveries, isLoading } = useGetDriverDeliveries();

  if (isLoading) return <div>Loading deliveries...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-serif font-bold text-primary">Delivery History</h1>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Zone</TableHead>
                <TableHead className="text-right">Distance</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Fuel Credited</TableHead>
                <TableHead className="text-right">Your Payout</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries?.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(delivery.createdAt || '').toLocaleString()}
                  </TableCell>
                  <TableCell className="font-medium">{delivery.zone || "N/A"}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {delivery.distanceKm ? `${delivery.distanceKm.toFixed(1)} km` : '-'}
                  </TableCell>
                  <TableCell className="text-right">{formatZAR(delivery.priceCents)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatZAR(delivery.fuelCents)}</TableCell>
                  <TableCell className="text-right font-bold text-primary">{formatZAR(delivery.driverPayoutCents)}</TableCell>
                </TableRow>
              ))}
              {deliveries?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No deliveries found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
