import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/useUserRole";
import { ArrowLeft, Save, Upload } from "lucide-react";
import { useBpmnModeler } from "@/hooks/useBpmnModeler";
import { BpmnGraphicalEditor } from "@/components/BpmnGraphicalEditor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const FALLBACK_DIAGRAM_ID = "00000000-0000-0000-0000-000000000001";

const AdminFallbackDiagram = () => {
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("graphical");

  const { modeler, loading: modelerLoading, error, saveXml } = useBpmnModeler({
    entityId: FALLBACK_DIAGRAM_ID,
    entityType: "subprocess",
    onAutoSave: async () => {
      // Auto-save handled by the hook
    },
  });

  useEffect(() => {
    // Check authentication
    const storedUser = localStorage.getItem("currentUser");
    if (!storedUser) {
      navigate("/");
      return;
    }

    // Check admin access
    if (!roleLoading && !isAdmin) {
      toast.error("Access denied: Admin privileges required");
      navigate("/dashboard");
    }
  }, [navigate, isAdmin, roleLoading]);

  const handleSave = async () => {
    if (!modeler) return;

    setSaving(true);
    try {
      const xml = await saveXml();
      if (xml) {
        toast.success("Fallback diagram saved successfully");
      }
    } catch (error) {
      console.error("Error saving diagram:", error);
      toast.error("Failed to save diagram");
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !modeler) return;

    try {
      const xml = await file.text();
      
      // Update the database with the uploaded XML
      const { error } = await supabase
        .from("subprocesses")
        .upsert({
          id: FALLBACK_DIAGRAM_ID,
          name: "Fallback Diagram",
          service_id: FALLBACK_DIAGRAM_ID,
          original_bpmn_xml: xml,
          edited_bpmn_xml: xml,
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;

      // Reload the modeler with the new XML
      await modeler.importXML(xml);
      toast.success("Diagram uploaded successfully");
    } catch (error) {
      console.error("Error uploading diagram:", error);
      toast.error("Failed to upload diagram");
    }

    // Reset input
    event.target.value = "";
  };

  if (roleLoading || modelerLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-destructive">Error loading diagram: {error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card shadow-sm">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-bold text-primary">Fallback Diagram</h1>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="file-upload">
              <Button variant="outline" asChild>
                <span className="cursor-pointer">
                  <Upload className="h-4 w-4 mr-2" />
                  Upload BPMN
                </span>
              </Button>
            </label>
            <input
              id="file-upload"
              type="file"
              accept=".bpmn,.xml"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button onClick={handleSave} disabled={saving || !modeler}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Fallback BPMN Diagram</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              This diagram is used as a fallback for process steps that don't have their own
              diagram (e.g., when no PDF was available during MDS import). Edit the diagram
              below or upload a new BPMN file.
            </p>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="graphical">Graphical Editor</TabsTrigger>
              </TabsList>
              <TabsContent value="graphical" className="mt-4">
                <div className="border border-border rounded-lg overflow-hidden">
                  {modeler && (
                    <BpmnGraphicalEditor modeler={modeler} activeTab={activeTab} />
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default AdminFallbackDiagram;
