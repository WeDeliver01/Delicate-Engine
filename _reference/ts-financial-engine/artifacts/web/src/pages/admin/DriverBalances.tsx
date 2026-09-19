import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetDriverBalances, useRecordFuelSpend, getGetDriverBalancesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatZAR } from "@/lib/formatters";
import { useToast } from "@/hooks/use-toast";

export default function DriverBalances() {
  const { data: balances, isLoading } = useGetDriverBalances();
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const [fuelAmount, setFuelAmount] = useState("");
  const [fuelRef, setFuelRef] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const recordFuel = useRecordFuelSpend();

  const handleRecordFuel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDriver || !fuelAmount) return;

    recordFuel.mutate(
      { id: selectedDriver, data: { amountCents: Math.round(parseFloat(fuelAmount) * 100), reference: fuelRef } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetDriverBalancesQueryKey() });
          toast({ title: "Fuel spend recorded successfully" });
          setIsDialogOpen(false);
          setFuelAmount("");
          setFuelRef("");
        },
        onError: () => {
          toast({ title: "Failed to record fuel spend", variant: "destructive" });
        }
      }
    );
  };

  if (isLoading) return <div>Loading balances...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-serif font-bold text-primary">Driver Balances</h1>

      <Card>
        <CardHeader>
          <CardTitle>Current Status</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Driver</TableHead>
                <TableHead className="text-right">Available Earnings</TableHead>
                <TableHead className="text-right">Locked Earnings</TableHead>
                <TableHead className="text-right">Fuel Card Balance</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances?.map((b) => (
                <TableRow key={b.driverId}>
                  <TableCell className="font-medium">{b.driverName}</TableCell>
                  <TableCell className="text-right">{formatZAR(b.availableCents)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatZAR(b.lockedCents)}</TableCell>
                  <TableCell className="text-right font-mono">{formatZAR(b.fuelCents)}</TableCell>
                  <TableCell className="text-right">
                    <Dialog open={isDialogOpen && selectedDriver === b.driverId} onOpenChange={(open) => {
                      setIsDialogOpen(open);
                      if (open) setSelectedDriver(b.driverId);
                      else setSelectedDriver(null);
                    }}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm">Record Fuel</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Record Fuel Spend - {b.driverName}</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={handleRecordFuel} className="space-y-4 pt-4">
                          <div className="space-y-2">
                            <Label>Amount (ZAR)</Label>
                            <Input 
                              type="number" 
                              step="0.01" 
                              min="0"
                              value={fuelAmount} 
                              onChange={e => setFuelAmount(e.target.value)} 
                              required 
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Reference/Receipt (Optional)</Label>
                            <Input 
                              value={fuelRef} 
                              onChange={e => setFuelRef(e.target.value)} 
                            />
                          </div>
                          <DialogFooter>
                            <Button type="submit" disabled={recordFuel.isPending}>
                              {recordFuel.isPending ? "Saving..." : "Record Spend"}
                            </Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                </TableRow>
              ))}
              {balances?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No active driver balances found
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
