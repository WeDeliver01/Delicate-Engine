import { useListDriverPayouts } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatZAR } from "@/lib/formatters";

export default function DriverPayouts() {
  const { data: payouts, isLoading } = useListDriverPayouts();

  if (isLoading) return <div>Loading payouts...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-serif font-bold text-primary">Payout History</h1>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date Requested</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Processed At</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts?.map((payout) => (
                <TableRow key={payout.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(payout.createdAt || '').toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-bold">{formatZAR(payout.amountCents)}</TableCell>
                  <TableCell>
                    <Badge variant={payout.status === 'pending' ? 'secondary' : payout.status === 'paid' ? 'default' : 'destructive'}>
                      {payout.status.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {payout.processedAt ? new Date(payout.processedAt).toLocaleString() : "-"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {payout.note || "-"}
                  </TableCell>
                </TableRow>
              ))}
              {payouts?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No payout requests found
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
