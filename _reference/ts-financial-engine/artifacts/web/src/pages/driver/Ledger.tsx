import { useState } from "react";
import { useGetDriverLedger } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatZAR } from "@/lib/formatters";

export default function Ledger() {
  const [account, setAccount] = useState<'earnings' | 'fuel'>('earnings');
  const { data: ledger, isLoading } = useGetDriverLedger({ query: { queryKey: ['driverLedger', account] }, request: { params: { account } } } as any);
  // Actually, let's just use the generated hook signature:
  // useGetDriverLedger(params?: { account?: 'earnings'|'fuel' }, options?: ...)
  
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-serif font-bold text-primary">Transaction Ledger</h1>
        
        <Tabs value={account} onValueChange={(v) => setAccount(v as 'earnings' | 'fuel')} className="w-[200px]">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="earnings">Earnings</TabsTrigger>
            <TabsTrigger value="fuel">Fuel Card</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card>
        <CardContent className="p-0">
          <LedgerTable account={account} />
        </CardContent>
      </Card>
    </div>
  );
}

function LedgerTable({ account }: { account: 'earnings' | 'fuel' }) {
  const { data: ledger, isLoading } = useGetDriverLedger({ account });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading ledger...</div>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ledger?.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="text-sm text-muted-foreground">
              {new Date(entry.createdAt || '').toLocaleString()}
            </TableCell>
            <TableCell>
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-muted">
                {entry.type.replace('_', ' ')}
              </span>
            </TableCell>
            <TableCell className="max-w-[300px] truncate">{entry.description || "-"}</TableCell>
            <TableCell className={`text-right font-bold ${entry.amountCents > 0 ? 'text-green-600' : entry.amountCents < 0 ? 'text-red-600' : ''}`}>
              {entry.amountCents > 0 ? '+' : ''}{formatZAR(entry.amountCents)}
            </TableCell>
          </TableRow>
        ))}
        {ledger?.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
              No transactions found in this account
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
