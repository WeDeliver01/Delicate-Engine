import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListDrivers, useCreateDriver, useUpdateDriver, getListDriversQueryKey, Driver } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  depotLabel: z.string().optional(),
  depotLat: z.coerce.number().optional(),
  depotLng: z.coerce.number().optional(),
  vehicleKmPerLitre: z.coerce.number().optional(),
  fuelCardId: z.string().optional(),
  active: z.boolean().default(true),
});

export default function Drivers() {
  const { data: drivers, isLoading } = useListDrivers();
  const [isOpen, setIsOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  
  const queryClient = useQueryClient();
  const createDriver = useCreateDriver();
  const updateDriver = useUpdateDriver();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      depotLabel: "",
      depotLat: 0,
      depotLng: 0,
      vehicleKmPerLitre: 10,
      fuelCardId: "",
      active: true,
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    if (editingDriver) {
      updateDriver.mutate({ id: editingDriver.id, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListDriversQueryKey() });
          toast({ title: "Driver updated successfully" });
          setIsOpen(false);
        }
      });
    } else {
      createDriver.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListDriversQueryKey() });
          toast({ title: "Driver created successfully" });
          setIsOpen(false);
        }
      });
    }
  };

  const openEdit = (driver: Driver) => {
    setEditingDriver(driver);
    form.reset({
      name: driver.name,
      phone: driver.phone || "",
      email: driver.email || "",
      depotLabel: driver.depotLabel || "",
      depotLat: driver.depotLat,
      depotLng: driver.depotLng,
      vehicleKmPerLitre: driver.vehicleKmPerLitre || undefined,
      fuelCardId: driver.fuelCardId || "",
      active: driver.active,
    });
    setIsOpen(true);
  };

  const openCreate = () => {
    setEditingDriver(null);
    form.reset({
      name: "",
      phone: "",
      email: "",
      depotLabel: "",
      depotLat: 0,
      depotLng: 0,
      vehicleKmPerLitre: 10,
      fuelCardId: "",
      active: true,
    });
    setIsOpen(true);
  };

  const toggleActive = (driver: Driver, active: boolean) => {
    updateDriver.mutate({ id: driver.id, data: { active } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDriversQueryKey() });
      }
    });
  };

  if (isLoading) return <div>Loading drivers...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-serif font-bold text-primary">Drivers</h1>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>Add Driver</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingDriver ? "Edit Driver" : "Add New Driver"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="fuelCardId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fuel Card ID</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="depotLat"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Depot Lat</FormLabel>
                        <FormControl><Input type="number" step="0.0001" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="depotLng"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Depot Lng</FormLabel>
                        <FormControl><Input type="number" step="0.0001" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="vehicleKmPerLitre"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vehicle Km/Litre</FormLabel>
                      <FormControl><Input type="number" step="0.1" {...field} /></FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Active Status</FormLabel>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={createDriver.isPending || updateDriver.isPending}>
                  Save Driver
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
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Fuel Card</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drivers?.map((driver) => (
                <TableRow key={driver.id}>
                  <TableCell className="font-medium">{driver.name}</TableCell>
                  <TableCell>{driver.phone || "-"}</TableCell>
                  <TableCell className="font-mono text-sm">{driver.fuelCardId || "-"}</TableCell>
                  <TableCell>
                    <Badge variant={driver.active ? "default" : "secondary"}>
                      {driver.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(driver)}>Edit</Button>
                    <Button 
                      variant={driver.active ? "destructive" : "secondary"} 
                      size="sm"
                      onClick={() => toggleActive(driver, !driver.active)}
                    >
                      {driver.active ? "Deactivate" : "Activate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {drivers?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No drivers registered
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
