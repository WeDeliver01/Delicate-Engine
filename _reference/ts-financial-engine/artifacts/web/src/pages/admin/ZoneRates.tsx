import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListZoneRates, useCreateZoneRate, useUpdateZoneRate, useDeleteZoneRate, getListZoneRatesQueryKey, ZoneRate } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatZAR } from "@/lib/formatters";

const formSchema = z.object({
  bakeryId: z.string().optional(),
  zone: z.string().min(1, "Zone is required"),
  priceCents: z.coerce.number().min(0, "Price must be positive"),
  currency: z.string().default("ZAR"),
  source: z.string().optional(),
});

export default function ZoneRates() {
  const { data: zoneRates, isLoading } = useListZoneRates();
  const [isOpen, setIsOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<ZoneRate | null>(null);
  
  const queryClient = useQueryClient();
  const createRate = useCreateZoneRate();
  const updateRate = useUpdateZoneRate();
  const deleteRate = useDeleteZoneRate();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      bakeryId: "",
      zone: "",
      priceCents: 0,
      currency: "ZAR",
      source: "",
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    if (editingRate) {
      updateRate.mutate({ id: editingRate.id, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListZoneRatesQueryKey() });
          toast({ title: "Zone rate updated successfully" });
          setIsOpen(false);
        }
      });
    } else {
      createRate.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListZoneRatesQueryKey() });
          toast({ title: "Zone rate created successfully" });
          setIsOpen(false);
        }
      });
    }
  };

  const openEdit = (rate: ZoneRate) => {
    setEditingRate(rate);
    form.reset({
      bakeryId: rate.bakeryId || "",
      zone: rate.zone,
      priceCents: rate.priceCents / 100, // input is in Rands
      currency: rate.currency,
      source: rate.source || "",
    });
    setIsOpen(true);
  };

  const openCreate = () => {
    setEditingRate(null);
    form.reset({
      bakeryId: "",
      zone: "",
      priceCents: 0,
      currency: "ZAR",
      source: "",
    });
    setIsOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this zone rate?")) {
      deleteRate.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListZoneRatesQueryKey() });
          toast({ title: "Zone rate deleted successfully" });
        }
      });
    }
  };

  if (isLoading) return <div>Loading zone rates...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-serif font-bold text-primary">Zone Rates</h1>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>Add Zone Rate</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingRate ? "Edit Zone Rate" : "Add New Zone Rate"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => onSubmit({ ...d, priceCents: Math.round(d.priceCents * 100) }))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="zone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Zone</FormLabel>
                      <FormControl><Input placeholder="e.g. Zone 1" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="priceCents"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price (ZAR)</FormLabel>
                      <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="bakeryId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bakery ID (Optional)</FormLabel>
                      <FormControl><Input placeholder="Leave blank for global" {...field} /></FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="source"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Source (Optional)</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={createRate.isPending || updateRate.isPending}>
                  Save Zone Rate
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
                <TableHead>Zone</TableHead>
                <TableHead>Bakery</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {zoneRates?.map((rate) => (
                <TableRow key={rate.id}>
                  <TableCell className="font-medium">{rate.zone}</TableCell>
                  <TableCell>{rate.bakeryId ? `Bakery: ${rate.bakeryId}` : "Global"}</TableCell>
                  <TableCell className="text-right font-bold">{formatZAR(rate.priceCents)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{rate.source || "-"}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(rate)}>Edit</Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(rate.id)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
              {zoneRates?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No zone rates registered
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
