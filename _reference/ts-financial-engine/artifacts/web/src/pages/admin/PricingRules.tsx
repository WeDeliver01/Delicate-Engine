import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListPricingRules, useCreatePricingRule, useUpdatePricingRule, useDeletePricingRule, getListPricingRulesQueryKey, PricingRule } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatZAR, formatBps } from "@/lib/formatters";

const formSchema = z.object({
  label: z.string().optional(),
  scopeType: z.string().default("global"),
  scopeRef: z.string().optional(),
  distanceMinKm: z.coerce.number().optional(),
  distanceMaxKm: z.coerce.number().optional(),
  fuelCostPerKmCents: z.coerce.number(),
  driverBaseFeeCents: z.coerce.number(),
  variableCostsCents: z.coerce.number(),
  batchingBps: z.coerce.number(),
  strategy: z.string().default("fixed_share"),
  driverShareBps: z.coerce.number(),
  driverPerKmCents: z.coerce.number().optional(),
  priority: z.coerce.number().default(0),
  active: z.boolean().default(true),
});

export default function PricingRules() {
  const { data: rules, isLoading } = useListPricingRules();
  const [isOpen, setIsOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PricingRule | null>(null);
  
  const queryClient = useQueryClient();
  const createRule = useCreatePricingRule();
  const updateRule = useUpdatePricingRule();
  const deleteRule = useDeletePricingRule();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      label: "",
      scopeType: "global",
      scopeRef: "",
      fuelCostPerKmCents: 0,
      driverBaseFeeCents: 0,
      variableCostsCents: 0,
      batchingBps: 0,
      strategy: "fixed_share",
      driverShareBps: 0,
      priority: 0,
      active: true,
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    // Process input data where we collect ZAR/percentages and convert to cents/bps
    const processedData = {
      ...data,
      fuelCostPerKmCents: Math.round(data.fuelCostPerKmCents * 100),
      driverBaseFeeCents: Math.round(data.driverBaseFeeCents * 100),
      variableCostsCents: Math.round(data.variableCostsCents * 100),
      batchingBps: Math.round(data.batchingBps * 100),
      driverShareBps: Math.round(data.driverShareBps * 100),
      driverPerKmCents: data.driverPerKmCents ? Math.round(data.driverPerKmCents * 100) : undefined,
    };

    if (editingRule) {
      updateRule.mutate({ id: editingRule.id, data: processedData }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPricingRulesQueryKey() });
          toast({ title: "Pricing rule updated successfully" });
          setIsOpen(false);
        }
      });
    } else {
      createRule.mutate({ data: processedData }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPricingRulesQueryKey() });
          toast({ title: "Pricing rule created successfully" });
          setIsOpen(false);
        }
      });
    }
  };

  const openEdit = (rule: PricingRule) => {
    setEditingRule(rule);
    form.reset({
      label: rule.label || "",
      scopeType: rule.scopeType,
      scopeRef: rule.scopeRef || "",
      distanceMinKm: rule.distanceMinKm || undefined,
      distanceMaxKm: rule.distanceMaxKm || undefined,
      fuelCostPerKmCents: rule.fuelCostPerKmCents / 100,
      driverBaseFeeCents: rule.driverBaseFeeCents / 100,
      variableCostsCents: rule.variableCostsCents / 100,
      batchingBps: rule.batchingBps / 100,
      strategy: rule.strategy,
      driverShareBps: rule.driverShareBps / 100,
      driverPerKmCents: rule.driverPerKmCents ? rule.driverPerKmCents / 100 : undefined,
      priority: rule.priority,
      active: rule.active,
    });
    setIsOpen(true);
  };

  const openCreate = () => {
    setEditingRule(null);
    form.reset({
      label: "",
      scopeType: "global",
      scopeRef: "",
      fuelCostPerKmCents: 0,
      driverBaseFeeCents: 0,
      variableCostsCents: 0,
      batchingBps: 0,
      strategy: "fixed_share",
      driverShareBps: 0,
      priority: 0,
      active: true,
    });
    setIsOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this pricing rule?")) {
      deleteRule.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPricingRulesQueryKey() });
          toast({ title: "Pricing rule deleted successfully" });
        }
      });
    }
  };

  if (isLoading) return <div>Loading pricing rules...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-serif font-bold text-primary">Pricing Rules</h1>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>Add Pricing Rule</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingRule ? "Edit Pricing Rule" : "Add New Pricing Rule"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="label"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Label</FormLabel>
                        <FormControl><Input placeholder="Rule description" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority (Higher evaluated first)</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4 border p-4 rounded-md bg-muted/20">
                  <FormField
                    control={form.control}
                    name="scopeType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Scope Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select scope" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="global">Global</SelectItem>
                            <SelectItem value="bakery">Bakery</SelectItem>
                            <SelectItem value="driver">Driver</SelectItem>
                            <SelectItem value="zone">Zone</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="scopeRef"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Scope Ref (ID/Zone)</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="distanceMinKm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Min Distance (Km)</FormLabel>
                        <FormControl><Input type="number" step="0.1" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="distanceMaxKm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Max Distance (Km)</FormLabel>
                        <FormControl><Input type="number" step="0.1" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 border p-4 rounded-md bg-muted/20">
                  <FormField
                    control={form.control}
                    name="fuelCostPerKmCents"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fuel Cost/Km (ZAR)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="driverBaseFeeCents"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Driver Base Fee (ZAR)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="variableCostsCents"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Variable Costs (ZAR)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="strategy"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Strategy</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select strategy" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="fixed_share">Fixed Share</SelectItem>
                            <SelectItem value="distance_based">Distance Based</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="driverShareBps"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Driver Share (%)</FormLabel>
                        <FormControl><Input type="number" step="0.1" {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="batchingBps"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Batching Margin (%)</FormLabel>
                        <FormControl><Input type="number" step="0.1" {...field} /></FormControl>
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

                <Button type="submit" className="w-full" disabled={createRule.isPending || updateRule.isPending}>
                  Save Pricing Rule
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
                <TableHead>Priority</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Fuel/Km</TableHead>
                <TableHead>Driver Base</TableHead>
                <TableHead>Driver Share</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules?.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-mono text-muted-foreground">{rule.priority}</TableCell>
                  <TableCell className="font-medium">{rule.label || "Unnamed"}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{rule.scopeType}</span>
                      {rule.scopeRef && <span className="text-xs text-muted-foreground">{rule.scopeRef}</span>}
                    </div>
                  </TableCell>
                  <TableCell>{formatZAR(rule.fuelCostPerKmCents)}</TableCell>
                  <TableCell>{formatZAR(rule.driverBaseFeeCents)}</TableCell>
                  <TableCell>{formatBps(rule.driverShareBps)}</TableCell>
                  <TableCell>
                    <Badge variant={rule.active ? "default" : "secondary"}>
                      {rule.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(rule)}>Edit</Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(rule.id)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
              {rules?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No pricing rules registered
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
