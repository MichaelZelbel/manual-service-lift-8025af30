import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ExportModal } from "@/components/ExportModal";
import { useUserRole } from "@/hooks/useUserRole";
import { Settings, Upload } from "lucide-react";

interface User {
  bNumber: string;
  name: string;
  role: string;
}

interface ManualService {
  id: string;
  name: string;
  performing_team: string;
  performer_org: string;
  last_edited: string;
  last_bpmn_export: string | null;
  last_form_export: string | null;
  last_analysis: string | null;
}

const Dashboard = () => {
  const [user, setUser] = useState<User | null>(null);
  const [services, setServices] = useState<ManualService[]>([]);
  const [filteredServices, setFilteredServices] = useState<ManualService[]>([]);
  const [filterText, setFilterText] = useState("");
  const [loading, setLoading] = useState(true);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportModalType, setExportModalType] = useState<"export" | "analysis">("export");
  const [selectedService, setSelectedService] = useState<ManualService | null>(null);
  const { isAdmin } = useUserRole();
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is logged in
    const storedUser = localStorage.getItem("currentUser");
    if (!storedUser) {
      navigate("/");
      return;
    }
    setUser(JSON.parse(storedUser));
  }, [navigate]);

  useEffect(() => {
    fetchServices();
  }, []);

  useEffect(() => {
    // Filter services based on search text
    if (filterText.trim() === "") {
      setFilteredServices(services);
    } else {
      const filtered = services.filter(
        (service) =>
          service.name.toLowerCase().includes(filterText.toLowerCase()) ||
          service.performing_team.toLowerCase().includes(filterText.toLowerCase()) ||
          service.performer_org.toLowerCase().includes(filterText.toLowerCase())
      );
      setFilteredServices(filtered);
    }
  }, [filterText, services]);

  const fetchServices = async () => {
    try {
      const { data, error } = await supabase
        .from("manual_services")
        .select("*")
        .order("last_edited", { ascending: false });

      if (error) throw error;
      setServices(data || []);
      setFilteredServices(data || []);
    } catch (error) {
      console.error("Error fetching services:", error);
      toast.error("Failed to load manual services");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("currentUser");
    navigate("/");
  };

  const handleEditProcess = (id: string) => {
    navigate(`/process/${id}`);
  };

  const handleExport = (service: ManualService) => {
    setSelectedService(service);
    setExportModalType("export");
    setExportModalOpen(true);
  };

  const handleAnalysis = (service: ManualService) => {
    setSelectedService(service);
    setExportModalType("analysis");
    setExportModalOpen(true);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background animate-fade-in">
      {/* Header */}
      <header className="border-b border-border bg-card shadow-sm">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <button
            onClick={() => navigate("/dashboard")}
            className="hover:opacity-80 transition-opacity"
          >
            <h1 className="text-2xl font-bold text-primary">Manual Service Lift</h1>
          </button>
          <div className="flex items-center gap-4">
            {isAdmin && (
              <>
                <Button
                  variant="outline"
                  onClick={() => navigate("/admin/mds-import")}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  MDS Import
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate("/admin/templates")}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Form Templates
                </Button>
              </>
            )}
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{user.name}</p>
              <p className="text-xs text-muted-foreground">
                {user.role} · {user.bNumber}
              </p>
            </div>
            <Button variant="outline" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-foreground mb-6">Manual Services</h2>
          
          {/* Filter Bar */}
          <Input
            placeholder="Filter by name, team, or performer…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="max-w-md"
          />
        </div>

        {/* Service Grid */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading services...</p>
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              No manual services found. Try adjusting your filter.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredServices.map((service) => (
              <Card
                key={service.id}
                className="hover:shadow-lg transition-shadow duration-200"
              >
                <CardHeader>
                  <CardTitle className="text-lg">{service.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Team: </span>
                      <span className="font-medium">{service.performing_team}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Organisation: </span>
                      <span className="font-medium">{service.performer_org}</span>
                    </div>
                    <div className="pt-2 border-t border-border space-y-1">
                      <div className="text-xs text-muted-foreground">
                        Last edited: {formatDate(service.last_edited)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        BPMN export: {formatDate(service.last_bpmn_export)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Form export: {formatDate(service.last_form_export)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Backend analysis: {formatDate(service.last_analysis)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 pt-2">
                    <Button
                      onClick={() => handleEditProcess(service.id)}
                      className="w-full"
                      size="sm"
                    >
                      Edit Process
                    </Button>
                    <Button
                      onClick={() => handleExport(service)}
                      variant="outline"
                      className="w-full"
                      size="sm"
                    >
                      Export BPMN & Forms
                    </Button>
                    <Button
                      onClick={() => handleAnalysis(service)}
                      variant="secondary"
                      className="w-full"
                      size="sm"
                    >
                      Backend Analysis
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Export Modal */}
      {selectedService && (
        <ExportModal
          open={exportModalOpen}
          onOpenChange={(open) => {
            setExportModalOpen(open);
            if (!open) {
              // Refresh services after modal closes to show updated timestamps
              fetchServices();
            }
          }}
          type={exportModalType}
          serviceId={selectedService.id}
          serviceName={selectedService.name}
        />
      )}
    </div>
  );
};

export default Dashboard;
