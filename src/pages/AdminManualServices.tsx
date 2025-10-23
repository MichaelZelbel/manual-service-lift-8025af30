import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Trash2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

interface ManualService {
  id: string;
  name: string;
  performing_team: string;
  performer_org: string;
  created_at: string;
  last_edited: string;
}

export default function AdminManualServices() {
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [services, setServices] = useState<ManualService[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      navigate("/dashboard");
    }
  }, [isAdmin, roleLoading, navigate]);

  useEffect(() => {
    if (isAdmin) {
      fetchServices();
    }
  }, [isAdmin]);

  const fetchServices = async () => {
    try {
      const { data, error } = await supabase
        .from("manual_services")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setServices(data || []);
    } catch (error) {
      console.error("Error fetching manual services:", error);
      toast.error("Failed to load manual services");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (serviceId: string, serviceName: string) => {
    try {
      // Delete related data first
      const { error: stepsError } = await supabase
        .from("manual_service_steps")
        .delete()
        .eq("service_id", serviceId);

      if (stepsError) throw stepsError;

      // Delete related subprocesses
      const { error: subprocessError } = await supabase
        .from("subprocesses")
        .delete()
        .eq("service_id", serviceId);

      if (subprocessError) throw subprocessError;

      // Delete the service
      const { error: serviceError } = await supabase
        .from("manual_services")
        .delete()
        .eq("id", serviceId);

      if (serviceError) throw serviceError;

      toast.success(`Successfully deleted "${serviceName}"`);
      fetchServices();
    } catch (error) {
      console.error("Error deleting manual service:", error);
      toast.error("Failed to delete manual service");
    }
  };

  if (roleLoading || !isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => navigate("/dashboard")}
          className="mb-6"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Manage Manual Services</CardTitle>
            <CardDescription>
              Delete manual services from the system. This action cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Loading services...</p>
            ) : services.length === 0 ? (
              <p className="text-muted-foreground">No manual services found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service Name</TableHead>
                    <TableHead>Performing Team</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last Edited</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell className="font-medium">{service.name}</TableCell>
                      <TableCell>{service.performing_team}</TableCell>
                      <TableCell>{service.performer_org}</TableCell>
                      <TableCell>
                        {new Date(service.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {new Date(service.last_edited).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete the service "{service.name}" and all
                                its associated steps and subprocesses. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(service.id, service.name)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
