import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListBakeries, useCreateBakery, useUpdateBakery, getListBakeriesQueryKey, Bakery } from "@workspace/api-client-react";
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
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  pickupAddress: z.string().optional(),
  pickupLat: z.coerce.number(),
  pickupLng: z.coerce.number(),
  active: z.boolean().default(true),
});

export default function Bakeries() {
  const { data: bakeries, isLoading } = useListBakeries();
  const [isOpen, setIsOpen] = useState(false);
  const [editingBakery, setEditingBakery] = useState<Bakery | null>(null);
  
  const queryClient = useQueryClient();
  const createBakery = useCreateBakery();
  const updateBakery = useUpdateBakery();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: "",
      name: "",
      pickupAddress: "",
      pickupLat: 0,
      pickupLng: 0,
      active: true,
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    if (editingBakery) {
      updateBakery.mutate({ id: editingBakery.id, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBakeriesQueryKey() });
          toast({ title: "Bakery client updated successfully" });
          setIsOpen(false);
        }
      });
    } else {
      createBakery.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBakeriesQueryKey() });
          toast({ title: "Bakery client created successfully" });
          setIsOpen(false);
        }
      });
    }
  };

  const openEdit = (bakery: Bakery) => {
    setEditingBakery(bakery);
    form.reset({
      code: bakery.code,
      name: bakery.name,
      pickupAddress: bakery.pickupAddress || "",
      pickupLat: bakery.pickupLat,
      pickupLng: bakery.pickupLng,
      active: bakery.active,
    });
    setIsOpen(true);
  };

  const openCreate = () => {
    setEditingBakery(null);
    form.reset({
      code: "",
      name: "",
      pickupAddress: "",
      pickupLat: 0,
      pickupLng: 0,
      active: true,
    });
    setIsOpen(true);
  };

  const toggleActive = (bakery: Bakery, active: boolean) => {
    updateBakery.mutate({ id: bakery.id, data: { active } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBakeriesQueryKey() });
      }
    });
  };

  if (isLoading) return <div>Loading bakeries...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-serif font-bold text-primary">Bakery Clients</h1>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>Add Bakery</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingBakery ? "Edit Bakery Client" : "Add New Bakery Client"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem className="col-span-1">
                        <FormLabel>Code</FormLabel>
                        <FormControl><Input placeholder="BKY01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Name</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="pickupAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="pickupLat"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Latitude</FormLabel>
                        <FormControl><Input type="number" step="0.0001" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="pickupLng"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Longitude</FormLabel>
                        <FormControl><Input type="number" step="0.0001" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                </div>
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
                <Button type="submit" className="w-full" disabled={createBakery.isPending || updateBakery.isPending}>
                  Save Bakery
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
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bakeries?.map((bakery) => (
                <TableRow key={bakery.id}>
                  <TableCell className="font-mono font-medium">{bakery.code}</TableCell>
                  <TableCell>{bakery.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{bakery.pickupLat.toFixed(4)}, {bakery.pickupLng.toFixed(4)}</TableCell>
                  <TableCell>
                    <Badge variant={bakery.active ? "default" : "secondary"}>
                      {bakery.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(bakery)}>Edit</Button>
                    <Button 
                      variant={bakery.active ? "destructive" : "secondary"} 
                      size="sm"
                      onClick={() => toggleActive(bakery, !bakery.active)}
                    >
                      {bakery.active ? "Deactivate" : "Activate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {bakeries?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No bakery clients registered
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
