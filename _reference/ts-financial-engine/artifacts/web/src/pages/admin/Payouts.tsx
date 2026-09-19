import { useQueryClient } from "@tanstack/react-query";
import { useListAdminPayouts, useProcessAdminPayout, getListAdminPayoutsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatZAR } from "@/lib/formatters";

export default function Payouts() {
  const { data: payouts, isLoading } = useListAdminPayouts();
  const queryClient = useQueryClient();
  const processPayout = useProcessAdminPayout();
  const { toast } = useToast();

  const handleProcess = (id: string, status: 'paid' | 'cancelled') => {
    processPayout.mutate({ id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminPayoutsQueryKey() });
        toast({ title: `Payout marked as ${status}` });
      }
    });
  };

  if (isLoading) return <div>Loading payouts...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-serif font-bold text-primary">Payout Requests</h1>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Driver ID</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts?.map((payout) => (
                <TableRow key={payout.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(payout.createdAt || '').toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{payout.driverId}</TableCell>
                  <TableCell className="text-right font-bold">{formatZAR(payout.amountCents)}</TableCell>
                  <TableCell>
                    <Badge variant={payout.status === 'pending' ? 'secondary' : payout.status === 'paid' ? 'default' : 'destructive'}>
                      {payout.status.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                    {payout.note || "-"}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    {payout.status === 'pending' && (
                      <>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 border-green-200"
                          onClick={() => handleProcess(payout.id, 'paid')}
                          disabled={processPayout.isPending}
                        >
                          Approve
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800 border-red-200"
                          onClick={() => handleProcess(payout.id, 'cancelled')}
                          disabled={processPayout.isPending}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {payouts?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No payout requests
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
