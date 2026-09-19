import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateDelivery, useListDrivers, useListBakeries, useGetAdminActivity, getGetAdminActivityQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatZAR, formatBps } from "@/lib/formatters";

const formSchema = z.object({
  driverId: z.string().min(1, "Driver is required"),
  bakeryId: z.string().min(1, "Bakery is required"),
  zone: z.string().optional(),
  priceCents: z.coerce.number().optional(),
  customerLat: z.coerce.number().min(-90).max(90),
  customerLng: z.coerce.number().min(-180).max(180),
  customerAddress: z.string().optional(),
});

export default function Deliveries() {
  const { data: activity, isLoading: loadingActivity } = useGetAdminActivity();
  const { data: drivers } = useListDrivers();
  const { data: bakeries } = useListBakeries();
  
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const createDelivery = useCreateDelivery();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      driverId: "",
      bakeryId: "",
      zone: "",
      priceCents: 0,
      customerLat: 0,
      customerLng: 0,
      customerAddress: "",
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    const payload = {
      driverId: data.driverId,
      bakeryId: data.bakeryId,
      zone: data.zone || undefined,
      priceCents: data.priceCents ? Math.round(data.priceCents * 100) : undefined,
      customer: {
        lat: data.customerLat,
        lng: data.customerLng,
        address: data.customerAddress || undefined,
      },
      idempotencyKey: `manual-${Date.now()}`
    };

    createDelivery.mutate({ data: payload }, {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getGetAdminActivityQueryKey() });
        toast({ title: `Delivery settled! Margin: ${formatBps(res.settlement.marginBps)}` });
        setIsOpen(false);
        form.reset();
      },
      onError: (err: any) => {
        toast({ title: "Failed to settle delivery", description: err.message, variant: "destructive" });
      }
    });
  };

  const getDriverName = (id: string) => drivers?.find(d => d.id === id)?.name || id;
  const getBakeryName = (id: string) => bakeries?.find(b => b.id === id)?.name || id;

  if (loadingActivity) return <div>Loading deliveries...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-serif font-bold text-primary">Deliveries</h1>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button>Record Delivery</Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Record and Settle Delivery</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="driverId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Driver</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select driver" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {drivers?.filter(d => d.active).map(driver => (
                              <SelectItem key={driver.id} value={driver.id}>{driver.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="bakeryId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bakery Client</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select bakery" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {bakeries?.filter(b => b.active).map(bakery => (
                              <SelectItem key={bakery.id} value={bakery.id}>{bakery.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="zone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Zone (Optional)</FormLabel>
                        <FormControl><Input placeholder="e.g. Zone A" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="priceCents"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Price Override (ZAR)</FormLabel>
                        <FormControl><Input type="number" step="0.01" placeholder="Leave blank for auto-pricing" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="customerLat"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Customer Lat</FormLabel>
                        <FormControl><Input type="number" step="0.0001" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="customerLng"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Customer Lng</FormLabel>
                        <FormControl><Input type="number" step="0.0001" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                
                <FormField
                  control={form.control}
                  name="customerAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer Address (Optional)</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full" disabled={createDelivery.isPending}>
                  Settle Delivery
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Bakery</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Driver Payout</TableHead>
                <TableHead className="text-right">Fuel</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activity?.deliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(delivery.createdAt || '').toLocaleString()}
                  </TableCell>
                  <TableCell className="font-medium">{getDriverName(delivery.driverId)}</TableCell>
                  <TableCell>{getBakeryName(delivery.bakeryId)}</TableCell>
                  <TableCell className="text-right font-bold">{formatZAR(delivery.priceCents)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatZAR(delivery.driverPayoutCents)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatZAR(delivery.fuelCents)}</TableCell>
                  <TableCell className="text-right">{formatBps(delivery.marginBps)}</TableCell>
                  <TableCell>
                    <Badge variant={delivery.status === 'settled' ? 'default' : 'secondary'}>
                      {delivery.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {activity?.deliveries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No deliveries recorded
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
