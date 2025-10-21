import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import BpmnModeler from "bpmn-js/lib/Modeler";
import propertiesPanelModule from "@bpmn-io/properties-panel";
// @ts-ignore - camunda provider has no types
import camundaPropertiesProviderModule from "bpmn-js-properties-panel/lib/provider/camunda";
import minimapModule from "diagram-js-minimap";
import camundaModdleDescriptor from "camunda-bpmn-moddle/resources/camunda.json";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Map,
  Upload,
  Download,
  RotateCcw,
  Save,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import "./BpmnGraphicalEditor.css";

interface BpmnGraphicalEditorProps {
  entityId: string;
  entityType: "service" | "subprocess";
  onSave?: () => void;
}

const EMPTY_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Start"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="173" y="102" width="36" height="36"/>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

export function BpmnGraphicalEditor({
  entityId,
  entityType,
  onSave,
}: BpmnGraphicalEditorProps) {
  const navigate = useNavigate();
  const modelerRef = useRef<BpmnModeler | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const propertiesPanelRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [originalXml, setOriginalXml] = useState<string>("");
  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  const tableName = entityType === "service" ? "manual_services" : "subprocesses";

  // Load BPMN from database
  const loadBpmn = useCallback(async () => {
    console.log("BpmnEditor: loadBpmn called for", entityType, entityId);
    try {
      setLoading(true);
      console.log("BpmnEditor: Fetching from table", tableName);
      
      const { data, error } = await supabase
        .from(tableName)
        .select("original_bpmn_xml, edited_bpmn_xml")
        .eq("id", entityId)
        .single();

      if (error) {
        console.error("BpmnEditor: Database error", error);
        throw error;
      }

      console.log("BpmnEditor: Data fetched", { 
        hasOriginal: !!data.original_bpmn_xml, 
        hasEdited: !!data.edited_bpmn_xml 
      });

      const xmlToLoad = data.edited_bpmn_xml || data.original_bpmn_xml || EMPTY_BPMN;
      setOriginalXml(data.original_bpmn_xml || EMPTY_BPMN);

      if (modelerRef.current) {
        console.log("BpmnEditor: Importing XML into modeler");
        await modelerRef.current.importXML(xmlToLoad);
        console.log("BpmnEditor: XML imported successfully");
        
        const canvas = modelerRef.current.get("canvas") as any;
        canvas.zoom("fit-viewport");
        toast.success("BPMN loaded successfully");
      } else {
        console.warn("BpmnEditor: Modeler ref not available");
      }
    } catch (error) {
      console.error("BpmnEditor: Error loading BPMN:", error);
      toast.error("Failed to load BPMN diagram");
      // Load empty diagram on error
      if (modelerRef.current) {
        try {
          await modelerRef.current.importXML(EMPTY_BPMN);
        } catch (e) {
          console.error("BpmnEditor: Failed to load empty diagram", e);
        }
      }
    } finally {
      console.log("BpmnEditor: Setting loading to false");
      setLoading(false);
    }
  }, [entityId, tableName, entityType]);

  // Save BPMN to database (debounced)
  const saveBpmn = useCallback(async () => {
    if (!modelerRef.current) return;

    try {
      setSaving(true);
      const { xml } = await modelerRef.current.saveXML({ format: true });

      // Validate XML
      if (!xml || !xml.includes("<bpmn:definitions")) {
        throw new Error("Invalid BPMN XML");
      }

      const { error } = await supabase
        .from(tableName)
        .update({ edited_bpmn_xml: xml })
        .eq("id", entityId);

      if (error) throw error;

      toast.success("Changes saved");
      onSave?.();
    } catch (error) {
      console.error("Error saving BPMN:", error);
      toast.error("Failed to save changes");
    } finally {
      setSaving(false);
    }
  }, [entityId, tableName, onSave]);

  // Debounced auto-save
  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveBpmn();
    }, 1200);
  }, [saveBpmn]);

  // Initialize modeler
  useEffect(() => {
    console.log("BpmnEditor: Initialize effect running");
    let destroyed = false;
    let modeler: BpmnModeler | null = null;

    const init = () => {
      if (destroyed) return;

      if (!containerRef.current || !propertiesPanelRef.current) {
        // Wait until refs are attached
        setTimeout(init, 50);
        return;
      }

      console.log("BpmnEditor: Initializing modeler");

      try {
        modeler = new BpmnModeler({
          container: containerRef.current,
          propertiesPanel: {
            parent: propertiesPanelRef.current,
          },
          additionalModules: [
            propertiesPanelModule,
            camundaPropertiesProviderModule,
            minimapModule,
          ],
          moddleExtensions: {
            camunda: camundaModdleDescriptor,
          },
          keyboard: { bindTo: document },
        });

        modelerRef.current = modeler;
        console.log("BpmnEditor: Modeler created successfully");

        const eventBus = modeler.get("eventBus") as any;
        eventBus.on("commandStack.changed", debouncedSave);

        // Double-click navigation from callActivity
        eventBus.on("element.dblclick", async (event: any) => {
          const element = event.element;
          if (element.type === "bpmn:CallActivity" && entityType === "service") {
            const calledElement = element.businessObject.calledElement;
            if (calledElement) {
              const match = calledElement.match(/Process_Sub_(.+)$/);
              if (match) {
                const stepExternalId = match[1];
                // Try lookup by calledElement → subprocess via steps table if available
                const { data, error } = await supabase
                  .from("manual_service_steps")
                  .select("subprocess_id")
                  .eq("service_id", entityId)
                  .maybeSingle();

                if (error) console.warn("Lookup error", error);

                if (data?.subprocess_id) {
                  navigate(`/subprocess/${data.subprocess_id}`);
                } else {
                  toast.error("No linked subprocess found");
                }
              }
            }
          }
        });

        // Defer load to next tick to ensure layout is ready
        setTimeout(() => {
          loadBpmn().catch((err) => console.error("BpmnEditor: loadBpmn failed", err));
        }, 0);
      } catch (error) {
        console.error("BpmnEditor: Failed to initialize modeler", error);
        toast.error("Failed to initialize BPMN editor");
        setLoading(false);
      }
    };

    init();

    return () => {
      destroyed = true;
      console.log("BpmnEditor: Cleaning up");
      modeler?.destroy();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [entityId, entityType, navigate, debouncedSave, loadBpmn]);

  // Zoom controls
  const handleZoomIn = () => {
    const canvas = modelerRef.current?.get("canvas") as any;
    canvas?.zoom(canvas.zoom() + 0.1);
  };

  const handleZoomOut = () => {
    const canvas = modelerRef.current?.get("canvas") as any;
    canvas?.zoom(canvas.zoom() - 0.1);
  };

  const handleFitViewport = () => {
    const canvas = modelerRef.current?.get("canvas") as any;
    canvas?.zoom("fit-viewport");
  };

  const handleToggleMinimap = () => {
    setShowMinimap(!showMinimap);
    const minimap = modelerRef.current?.get("minimap") as any;
    if (minimap) {
      showMinimap ? minimap.close() : minimap.open();
    }
  };

  // Import BPMN
  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".bpmn,.xml";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        if (!text.includes("<bpmn:definitions")) {
          throw new Error("Invalid BPMN file");
        }
        await modelerRef.current?.importXML(text);
        const canvas = modelerRef.current?.get("canvas") as any;
        canvas?.zoom("fit-viewport");
        toast.success("BPMN imported successfully");
        debouncedSave();
      } catch (error) {
        console.error("Import error:", error);
        toast.error("Failed to import BPMN file");
      }
    };
    input.click();
  };

  // Export BPMN
  const handleExport = async () => {
    try {
      const { xml } = await modelerRef.current.saveXML({ format: true });
      const blob = new Blob([xml], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entityType}_${entityId}.bpmn`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("BPMN exported successfully");
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export BPMN");
    }
  };

  // Reset to AI version
  const handleReset = async () => {
    try {
      if (!originalXml) {
        toast.error("No original version available");
        return;
      }

      await modelerRef.current?.importXML(originalXml);
      const canvas = modelerRef.current?.get("canvas") as any;
      canvas?.zoom("fit-viewport");

      // Clear edited version in database
      await supabase
        .from(tableName)
        .update({ edited_bpmn_xml: null })
        .eq("id", entityId);

      toast.success("Reset to AI version successfully");
      setShowResetDialog(false);
    } catch (error) {
      console.error("Reset error:", error);
      toast.error("Failed to reset to AI version");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[600px] bg-card rounded-lg border border-border">
        <p className="text-muted-foreground">Loading BPMN editor...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between bg-card p-4 rounded-lg border border-border">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleZoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleZoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleFitViewport}>
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleMinimap}
            className={showMinimap ? "bg-accent" : ""}
          >
            <Map className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {saving && (
            <span className="text-sm text-muted-foreground">Saving...</span>
          )}
          <Button variant="outline" size="sm" onClick={handleImport}>
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowResetDialog(true)}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <Button size="sm" onClick={saveBpmn} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            Save Now
          </Button>
        </div>
      </div>

      {/* Editor Container */}
      <div className="flex gap-4">
        {/* Canvas */}
        <div
          ref={containerRef}
          className="flex-1 bg-card rounded-lg border border-border shadow-sm"
          style={{ height: "600px" }}
        />

        {/* Properties Panel */}
        <div
          ref={propertiesPanelRef}
          className="w-[360px] bg-card rounded-lg border border-border shadow-sm overflow-auto"
          style={{ height: "600px" }}
        />
      </div>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to AI Version?</AlertDialogTitle>
            <AlertDialogDescription>
              This will discard all your changes and restore the original
              AI-generated BPMN diagram. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
