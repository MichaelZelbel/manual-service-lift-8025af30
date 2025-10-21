import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { ArrowLeft, RotateCcw, Save, GripVertical, Download, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { ExportModal } from "@/components/ExportModal";
import { BpmnGraphicalEditor } from "@/components/BpmnGraphicalEditor";
import { BpmnListEditor } from "@/components/BpmnListEditor";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ManualService {
  id: string;
  name: string;
  performing_team: string;
  performer_org: string;
}

interface ProcessStep {
  id: string;
  service_id: string;
  name: string;
  description: string | null;
  step_order: number;
  connections: Array<{ targetStep: number; condition: string }>;
  original_order: number;
  subprocess_id: string | null;
}

interface SortableStepProps {
  step: ProcessStep;
  onShowConnections: (step: ProcessStep) => void;
  onEditSubprocess: (subprocessId: string | null) => void;
}

function SortableStep({ step, onShowConnections, onEditSubprocess }: SortableStepProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging ? '0 10px 20px rgba(0, 0, 0, 0.15)' : undefined,
    scale: isDragging ? '1.02' : '1',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-card p-4 rounded-lg border border-border hover:border-primary transition-all duration-200"
    >
      <div className="flex items-start gap-4">
        {/* Drag Handle */}
        <div
          {...attributes}
          {...listeners}
          className="flex-shrink-0 pt-1 cursor-grab active:cursor-grabbing hover:opacity-70 transition-opacity"
        >
          <GripVertical className="h-5 w-5 text-muted-foreground" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground mb-1">{step.name}</h3>
          {step.description && (
            <p className="text-sm text-muted-foreground mb-2">{step.description}</p>
          )}
          {step.connections.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Connects to: {step.connections.map(c => `Step ${c.targetStep}`).join(", ")}
            </p>
          )}
        </div>

        {/* Buttons */}
        <div className="flex gap-2 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onShowConnections(step);
            }}
          >
            Show Connections
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onEditSubprocess(step.subprocess_id);
            }}
          >
            Edit Subprocess
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ProcessEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [service, setService] = useState<ManualService | null>(null);
  const [steps, setSteps] = useState<ProcessStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [selectedStep, setSelectedStep] = useState<ProcessStep | null>(null);
  const [activeTab, setActiveTab] = useState("list");
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportModalType, setExportModalType] = useState<"export" | "analysis">("export");

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (id) {
      fetchServiceAndSteps();
    }
  }, [id]);

  const fetchServiceAndSteps = async () => {
    try {
      setLoading(true);
      
      // Fetch service details
      const { data: serviceData, error: serviceError } = await supabase
        .from("manual_services")
        .select("*")
        .eq("id", id)
        .single();

      if (serviceError) throw serviceError;
      setService(serviceData);

      // Fetch steps
      const { data: stepsData, error: stepsError } = await supabase
        .from("manual_service_steps")
        .select("*")
        .eq("service_id", id)
        .order("step_order", { ascending: true });

      if (stepsError) throw stepsError;
      setSteps(
        (stepsData || []).map((step) => ({
          ...step,
          connections: (step.connections as any) || [],
        }))
      );
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load manual service");
    } finally {
      setLoading(false);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = steps.findIndex((step) => step.id === active.id);
    const newIndex = steps.findIndex((step) => step.id === over.id);

    const newSteps = arrayMove(steps, oldIndex, newIndex);
    
    // Update step_order for all affected steps
    const updatedSteps = newSteps.map((step, index) => ({
      ...step,
      step_order: index + 1,
    }));

    setSteps(updatedSteps);

    // Save to database
    try {
      const updates = updatedSteps.map((step) =>
        supabase
          .from("manual_service_steps")
          .update({ step_order: step.step_order })
          .eq("id", step.id)
      );

      await Promise.all(updates);
      toast.success("Step order updated");
    } catch (error) {
      console.error("Error updating step order:", error);
      toast.error("Failed to update step order");
      // Revert on error
      fetchServiceAndSteps();
    }
  };

  const handleReset = async () => {
    try {
      // Reset all steps to original_order
      const updates = steps.map((step) =>
        supabase
          .from("manual_service_steps")
          .update({ step_order: step.original_order })
          .eq("id", step.id)
      );

      await Promise.all(updates);

      // Clear edited BPMN so the diagram resets to AI-generated version
      if (id) {
        await supabase
          .from("manual_services")
          .update({ edited_bpmn_xml: null })
          .eq("id", id);

        // Broadcast to editors to reload
        const ts = Date.now().toString();
        localStorage.setItem(`bpmn_updated_${id}`, ts);
        localStorage.setItem(`bpmn_my_save_${id}_process_reset`, ts);
      }

      await fetchServiceAndSteps();
      toast.success("Reset to AI version successfully");
    } catch (error) {
      console.error("Error resetting steps:", error);
      toast.error("Failed to reset to AI version");
    }
    setShowResetDialog(false);
  };

  const handleSaveAndExit = async () => {
    // Update last_edited timestamp
    try {
      await supabase
        .from("manual_services")
        .update({ last_edited: new Date().toISOString() })
        .eq("id", id);
      
      toast.success("Changes saved successfully");
      navigate("/dashboard");
    } catch (error) {
      console.error("Error saving:", error);
      toast.error("Failed to save changes");
    }
  };

  const handleEditSubprocess = (subprocessId: string | null) => {
    if (!subprocessId) {
      toast.error("No subprocess found for this step");
      return;
    }
    navigate(`/subprocess/${subprocessId}`);
  };

  const handleOpenExportModal = (type: "export" | "analysis") => {
    setExportModalType(type);
    setExportModalOpen(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!service) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Service not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background animate-fade-in">
      {/* Top Bar */}
      <div className="bg-card border-b border-border">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/dashboard")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-semibold text-foreground">
                  Edit Manual Service
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {service.name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => handleOpenExportModal("export")}
              >
                <Download className="h-4 w-4 mr-2" />
                Export BPMN
              </Button>
              <Button
                variant="outline"
                onClick={() => handleOpenExportModal("analysis")}
              >
                <BarChart3 className="h-4 w-4 mr-2" />
                Analysis
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowResetDialog(true)}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset to AI Version
              </Button>
              <Button onClick={handleSaveAndExit}>
                <Save className="h-4 w-4 mr-2" />
                Save & Exit
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="list">List Editor</TabsTrigger>
            <TabsTrigger value="graphical">Graphical Editor</TabsTrigger>
          </TabsList>

          <TabsContent value="list">
            {service && (
              <BpmnListEditor
                entityId={service.id}
                entityType="service"
                onSave={fetchServiceAndSteps}
              />
            )}
          </TabsContent>

          <TabsContent value="graphical">
            {service && (
              <BpmnGraphicalEditor
                entityId={service.id}
                entityType="service"
                onSave={fetchServiceAndSteps}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to AI Version?</AlertDialogTitle>
            <AlertDialogDescription>
              This will discard all your changes and restore the original AI-generated
              process order. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Connections Dialog */}
      <Dialog open={!!selectedStep} onOpenChange={() => setSelectedStep(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Step Connections</DialogTitle>
            <DialogDescription>
              Outgoing connections from "{selectedStep?.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {selectedStep?.connections.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No outgoing connections
              </p>
            ) : (
              selectedStep?.connections.map((conn, idx) => (
                <div
                  key={idx}
                  className="bg-muted/50 p-3 rounded-md border border-border"
                >
                  <p className="text-sm font-medium text-foreground">
                    Target: Step {conn.targetStep}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Condition: {conn.condition}
                  </p>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Export Modal */}
      {service && (
        <ExportModal
          open={exportModalOpen}
          onOpenChange={(open) => {
            setExportModalOpen(open);
            if (!open) {
              // Refresh service data after modal closes
              fetchServiceAndSteps();
            }
          }}
          type={exportModalType}
          serviceId={service.id}
          serviceName={service.name}
        />
      )}
    </div>
  );
}
