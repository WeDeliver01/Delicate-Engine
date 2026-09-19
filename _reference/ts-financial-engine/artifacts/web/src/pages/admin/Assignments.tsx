import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListAssignments, useCreateAssignment, useListDrivers, useListBakeries, getListAssignmentsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const formSchema = z.object({
  driverId: z.string().min(1, "Driver is required"),
  bakeryId: z.string().min(1, "Bakery is required"),
});

export default function Assignments() {
  const { data: assignments, isLoading: loadingAssignments } = useListAssignments();
  const { data: drivers, isLoading: loadingDrivers } = useListDrivers();
  const { data: bakeries, isLoading: loadingBakeries } = useListBakeries();
  
  const [isOpen, setIsOpen] = useState(false);
  
  const queryClient = useQueryClient();
  const createAssignment = useCreateAssignment();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      driverId: "",
      bakeryId: "",
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    createAssignment.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAssignmentsQueryKey() });
        toast({ title: "Assignment created successfully" });
        setIsOpen(false);
        form.reset();
      }
    });
  };

  const getDriverName = (id: string) => drivers?.find(d => d.id === id)?.name || id;
  const getBakeryName = (id: string) => bakeries?.find(b => b.id === id)?.name || id;

  if (loadingAssignments || loadingDrivers || loadingBakeries) return <div>Loading assignments...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-serif font-bold text-primary">Driver Assignments</h1>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button>New Assignment</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Pair Driver to Bakery</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
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
                
                <Button type="submit" className="w-full" disabled={createAssignment.isPending}>
                  Create Assignment
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
                <TableHead>Driver</TableHead>
                <TableHead>Bakery Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments?.map((assignment) => (
                <TableRow key={assignment.id}>
                  <TableCell className="font-medium">{getDriverName(assignment.driverId)}</TableCell>
                  <TableCell>{getBakeryName(assignment.bakeryId)}</TableCell>
                  <TableCell>
                    <Badge variant={assignment.active ? "default" : "secondary"}>
                      {assignment.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(assignment.createdAt || '').toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
              {assignments?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    No assignments found
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
