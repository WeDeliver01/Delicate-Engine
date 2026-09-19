import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetDriverWallet, useRequestPayout, getGetDriverWalletQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatZAR } from "@/lib/formatters";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

export default function Wallet() {
  const { data: wallet, isLoading } = useGetDriverWallet();
  const [payoutAmount, setPayoutAmount] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  const queryClient = useQueryClient();
  const requestPayout = useRequestPayout();
  const { toast } = useToast();

  const handleRequestPayout = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet) return;

    const amountCents = Math.round(parseFloat(payoutAmount) * 100);
    if (amountCents > wallet.availableForPayout) {
      toast({ title: "Amount exceeds available balance", variant: "destructive" });
      return;
    }

    requestPayout.mutate({ data: { amountCents } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDriverWalletQueryKey() });
        toast({ title: "Payout requested successfully" });
        setIsDialogOpen(false);
        setPayoutAmount("");
      },
      onError: (err: any) => {
        toast({ title: "Failed to request payout", description: err.message, variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-serif font-bold text-primary">Your Wallet</h1>
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-serif font-bold text-primary">Your Wallet</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="lg" disabled={!wallet || wallet.availableForPayout <= 0}>
              Request Payout
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Payout</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleRequestPayout} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Available to payout</Label>
                <div className="text-2xl font-bold">{formatZAR(wallet?.availableForPayout)}</div>
              </div>
              <div className="space-y-2">
                <Label>Amount to request (ZAR)</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  min="0"
                  max={wallet ? wallet.availableForPayout / 100 : 0}
                  value={payoutAmount} 
                  onChange={e => setPayoutAmount(e.target.value)} 
                  required 
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={requestPayout.isPending}>
                  {requestPayout.isPending ? "Requesting..." : "Confirm Request"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-primary text-primary-foreground border-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-primary-foreground/80">Available Earnings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatZAR(wallet?.earnings.available)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Locked Earnings</CardTitle>
            <CardDescription className="text-xs">
              {wallet?.earnings.nextUnlock ? `Next unlock: ${new Date(wallet.earnings.nextUnlock).toLocaleDateString()}` : 'No locked earnings'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">{formatZAR(wallet?.earnings.locked)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Lifetime Earnings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatZAR(wallet?.earnings.total)}</div>
          </CardContent>
        </Card>

        <Card className="bg-muted">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fuel Card Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{formatZAR(wallet?.fuelCents)}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
