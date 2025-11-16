import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BpmnGraphicalEditor } from "@/components/BpmnGraphicalEditor";
import { BpmnListEditor } from "@/components/BpmnListEditor";
import { SubprocessList } from "@/components/SubprocessList";
import { ExportModal } from "@/components/ExportModal";
import { BpmnCheckModal } from "@/components/BpmnCheckModal";
import { TransferToCamundaModal } from "@/components/TransferToCamundaModal";
import { useBpmnModeler } from "@/hooks/useBpmnModeler";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft,
  Download,
  Upload,
  RotateCcw,
  FileDown,
  Undo2,
  CheckCircle,
} from "lucide-react";

export default function ProcessEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [checkModalOpen, setCheckModalOpen] = useState(false);
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkAssessment, setCheckAssessment] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("list");
  const [processName, setProcessName] = useState<string>("");

  const bpmn = useBpmnModeler({
    entityId: id!,
    entityType: "service",
  });

  useEffect(() => {
    const fetchProcessName = async () => {
      if (!id) return;
      
      const { data, error } = await supabase
        .from("manual_services")
        .select("name")
        .eq("id", id)
        .single();

      if (error) {
        console.error("Error fetching process name:", error);
        return;
      }

      setProcessName(data.name);
    };

    fetchProcessName();
  }, [id]);

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !id || !bpmn.modeler) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const xml = e.target?.result as string;
      if (!xml) return;

      try {
        await bpmn.loadXml(xml);
        const savedXml = await bpmn.saveXml();
        if (!savedXml) throw new Error("Failed to save XML");

        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase
          .from("manual_services")
          .update({ edited_bpmn_xml: savedXml })
          .eq("id", id);

        if (error) throw error;

        const bc = new BroadcastChannel("bpmn");
        bc.postMessage({ entityId: id, timestamp: Date.now() });
        bc.close();

        toast.success("BPMN imported successfully");
      } catch (error) {
        console.error("Error importing BPMN:", error);
        toast.error("Failed to import BPMN");
      }
    };
    reader.readAsText(file);
  };

  const handleExportBpmn = async () => {
    if (!id || !bpmn.modeler) return;
    try {
      const xml = await bpmn.saveXml();
      if (!xml) {
        toast.error("No BPMN data to export");
        return;
      }

      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("manual_services")
        .select("name")
        .eq("id", id)
        .single();

      const blob = new Blob([xml], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data?.name || "process"}.bpmn`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("BPMN exported");
    } catch (error) {
      console.error("Error exporting BPMN:", error);
      toast.error("Failed to export BPMN");
    }
  };

  const handleCheckBpmn = async () => {
    if (!bpmn.modeler) return;
    
    try {
      setCheckModalOpen(true);
      setCheckLoading(true);
      setCheckError(null);
      setCheckAssessment(null);

      const xml = await bpmn.saveXml();
      if (!xml) {
        setCheckError("No BPMN data to check");
        setCheckLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('check-bpmn', {
        body: {
          bpmnXml: xml,
          isManualService: true,
        },
      });

      if (error) throw error;

      if (data.error) {
        setCheckError(data.error);
      } else {
        setCheckAssessment(data.assessment);
      }
    } catch (error) {
      console.error("Error checking BPMN:", error);
      setCheckError("Could not complete analysis. Please try again.");
    } finally {
      setCheckLoading(false);
    }
  };

  if (bpmn.loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Card className="p-6">
          <p className="text-muted-foreground">Loading...</p>
        </Card>
      </div>
    );
  }

  if (bpmn.error) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Card className="p-6">
          <p className="text-destructive">{bpmn.error}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="container mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Process Editor
              </h1>
              <p className="text-sm text-muted-foreground">
                {processName || id}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={bpmn.undo}>
              <Undo2 className="h-4 w-4 mr-2" />
              Undo
            </Button>
            <Button variant="outline" size="sm" onClick={bpmn.reset}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset to AI Version
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportBpmn}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button variant="outline" size="sm" asChild>
              <label>
                <Upload className="h-4 w-4 mr-2" />
                Import
                <input
                  type="file"
                  accept=".bpmn,.xml"
                  onChange={handleImport}
                  className="hidden"
                />
              </label>
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleCheckBpmn}
              className="border-[#005A9C] text-[#005A9C] hover:bg-[#E6F0FA]"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Check
            </Button>
            <Button variant="default" size="sm" onClick={() => setExportModalOpen(true)}>
              <FileDown className="h-4 w-4 mr-2" />
              Download for Camunda
            </Button>
            <Button variant="default" size="sm" onClick={() => setTransferModalOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" />
              Transfer to Camunda
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="list">List Editor</TabsTrigger>
            <TabsTrigger value="graphical">Graphical Editor</TabsTrigger>
          </TabsList>

          <TabsContent value="graphical" className="space-y-4">
            {bpmn.modeler && (
              <BpmnGraphicalEditor modeler={bpmn.modeler} activeTab={activeTab} />
            )}
          </TabsContent>

          <TabsContent value="list" className="space-y-4">
            {bpmn.modeler && (
              <BpmnListEditor
                modeler={bpmn.modeler}
                entityId={id!}
                entityType="service"
              />
            )}
          </TabsContent>
        </Tabs>

        <ExportModal
          open={exportModalOpen}
          onOpenChange={setExportModalOpen}
          type="export"
          serviceId={id!}
          serviceName={processName || `Service ${id}`}
          bpmnModeler={bpmn.modeler}
        />

        <TransferToCamundaModal
          open={transferModalOpen}
          onOpenChange={setTransferModalOpen}
          serviceId={id!}
          serviceName={processName || `Service ${id}`}
          bpmnModeler={bpmn.modeler}
        />

        <BpmnCheckModal
          open={checkModalOpen}
          onOpenChange={setCheckModalOpen}
          loading={checkLoading}
          assessment={checkAssessment}
          error={checkError}
        />
      </div>
    </div>
  );
}
