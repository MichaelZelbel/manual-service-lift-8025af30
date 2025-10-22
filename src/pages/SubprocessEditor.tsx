import { useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BpmnGraphicalEditor } from "@/components/BpmnGraphicalEditor";
import { BpmnListEditor } from "@/components/BpmnListEditor";
import { useBpmnModeler } from "@/hooks/useBpmnModeler";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  Upload,
  RotateCcw,
  Undo2,
} from "lucide-react";

export default function SubprocessEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "graphical");

  const bpmn = useBpmnModeler({
    entityId: id!,
    entityType: "subprocess",
  });

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
          .from("subprocesses")
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
        .from("subprocesses")
        .select("name")
        .eq("id", id)
        .single();

      const blob = new Blob([xml], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data?.name || "subprocess"}.bpmn`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("BPMN exported");
    } catch (error) {
      console.error("Error exporting BPMN:", error);
      toast.error("Failed to export BPMN");
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
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Subprocess Editor
              </h1>
              <p className="text-sm text-muted-foreground">Subprocess ID: {id}</p>
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
              Export BPMN
            </Button>
            <Button variant="outline" size="sm" asChild>
              <label>
                <Upload className="h-4 w-4 mr-2" />
                Import BPMN
                <input
                  type="file"
                  accept=".bpmn,.xml"
                  onChange={handleImport}
                  className="hidden"
                />
              </label>
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
              <BpmnGraphicalEditor modeler={bpmn.modeler} />
            )}
          </TabsContent>

          <TabsContent value="list" className="space-y-4">
            {bpmn.modeler && (
              <BpmnListEditor
                modeler={bpmn.modeler}
                entityId={id!}
                entityType="subprocess"
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
