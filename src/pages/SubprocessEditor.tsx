import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { ArrowLeft, RotateCcw, Save, GripVertical, Plus, Trash2, Download, BarChart3 } from "lucide-react";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Subprocess {
  id: string;
  service_id: string;
  name: string;
}

interface ManualService {
  id: string;
  name: string;
}

interface SubprocessStep {
  id: string;
  subprocess_id: string;
  name: string;
  description: string | null;
  step_order: number;
  connections: Array<{ targetStep: number; condition: string }>;
  original_order: number;
}

interface SortableStepProps {
  step: SubprocessStep;
  onShowConnections: (step: SubprocessStep) => void;
  onDelete: (step: SubprocessStep) => void;
}

function SortableStep({ step, onShowConnections, onDelete }: SortableStepProps) {
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

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
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
              onDelete(step);
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SubprocessEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [subprocess, setSubprocess] = useState<Subprocess | null>(null);
  const [service, setService] = useState<ManualService | null>(null);
  const [steps, setSteps] = useState<SubprocessStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedStep, setSelectedStep] = useState<SubprocessStep | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportModalType, setExportModalType] = useState<"export" | "analysis">("export");
  const [stepToDelete, setStepToDelete] = useState<SubprocessStep | null>(null);
  const [activeTab, setActiveTab] = useState("list");
  const [newStepName, setNewStepName] = useState("");
  const [newStepDescription, setNewStepDescription] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (id) {
      fetchSubprocessAndSteps();
    }
  }, [id]);

  const fetchSubprocessAndSteps = async () => {
    try {
      setLoading(true);
      
      // Fetch subprocess details
      const { data: subprocessData, error: subprocessError } = await supabase
        .from("subprocesses")
        .select("*")
        .eq("id", id)
        .single();

      if (subprocessError) throw subprocessError;
      setSubprocess(subprocessData);

      // Fetch service details
      const { data: serviceData, error: serviceError } = await supabase
        .from("manual_services")
        .select("id, name")
        .eq("id", subprocessData.service_id)
        .single();

      if (serviceError) throw serviceError;
      setService(serviceData);

      // Fetch steps
      const { data: stepsData, error: stepsError } = await supabase
        .from("subprocess_steps")
        .select("*")
        .eq("subprocess_id", id)
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
      toast.error("Failed to load subprocess");
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
          .from("subprocess_steps")
          .update({ step_order: step.step_order })
          .eq("id", step.id)
      );

      await Promise.all(updates);
      toast.success("Step order updated");
    } catch (error) {
      console.error("Error updating step order:", error);
      toast.error("Failed to update step order");
      fetchSubprocessAndSteps();
    }
  };

  const handleReset = async () => {
    try {
      // Reset all steps to original_order
      const updates = steps.map((step) =>
        supabase
          .from("subprocess_steps")
          .update({ step_order: step.original_order })
          .eq("id", step.id)
      );

      await Promise.all(updates);

      // Clear edited BPMN so the diagram resets to AI-generated version
      if (id) {
        await supabase
          .from("subprocesses")
          .update({ edited_bpmn_xml: null })
          .eq("id", id);

        // Broadcast to editors to reload
        const ts = Date.now().toString();
        localStorage.setItem(`bpmn_updated_${id}`, ts);
        localStorage.setItem(`bpmn_my_save_${id}_subprocess_reset`, ts);
      }

      await fetchSubprocessAndSteps();
      toast.success("Reset to AI version successfully");
    } catch (error) {
      console.error("Error resetting steps:", error);
      toast.error("Failed to reset to AI version");
    }
    setShowResetDialog(false);
  };

  const handleAddStep = async () => {
    if (!newStepName.trim()) {
      toast.error("Step name is required");
      return;
    }

    try {
      const maxOrder = steps.length > 0 ? Math.max(...steps.map(s => s.step_order)) : 0;
      
      const { data, error } = await supabase
        .from("subprocess_steps")
        .insert({
          subprocess_id: id,
          name: newStepName.trim(),
          description: newStepDescription.trim() || null,
          step_order: maxOrder + 1,
          original_order: maxOrder + 1,
          connections: [],
        })
        .select()
        .single();

      if (error) throw error;

      setSteps([...steps, { ...data, connections: [] }]);
      toast.success("Step added successfully");
      setShowAddDialog(false);
      setNewStepName("");
      setNewStepDescription("");
    } catch (error) {
      console.error("Error adding step:", error);
      toast.error("Failed to add step");
    }
  };

  const handleDeleteStep = async () => {
    if (!stepToDelete) return;

    try {
      const { error } = await supabase
        .from("subprocess_steps")
        .delete()
        .eq("id", stepToDelete.id);

      if (error) throw error;

      // Reorder remaining steps
      const remainingSteps = steps
        .filter(s => s.id !== stepToDelete.id)
        .map((step, index) => ({
          ...step,
          step_order: index + 1,
        }));

      setSteps(remainingSteps);

      // Update orders in database
      const updates = remainingSteps.map((step) =>
        supabase
          .from("subprocess_steps")
          .update({ step_order: step.step_order })
          .eq("id", step.id)
      );

      await Promise.all(updates);
      toast.success("Step deleted successfully");
    } catch (error) {
      console.error("Error deleting step:", error);
      toast.error("Failed to delete step");
    }
    setShowDeleteDialog(false);
    setStepToDelete(null);
  };

  const handleSaveAndExit = async () => {
    try {
      await supabase
        .from("subprocesses")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", id);
      
      toast.success("Changes saved successfully");
      if (subprocess?.service_id) {
        navigate(`/process/${subprocess.service_id}`);
      }
    } catch (error) {
      console.error("Error saving:", error);
      toast.error("Failed to save changes");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!subprocess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Subprocess not found</p>
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
                onClick={() => navigate(`/process/${subprocess.service_id}`)}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-semibold text-foreground">
                  Edit Subprocess
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {subprocess.name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => { setExportModalType("export"); setExportModalOpen(true); }}>
                <Download className="h-4 w-4 mr-2" />
                Export BPMN
              </Button>
              <Button variant="outline" onClick={() => { setExportModalType("analysis"); setExportModalOpen(true); }}>
                <BarChart3 className="h-4 w-4 mr-2" />
                Analysis
              </Button>
              <Button variant="outline" onClick={() => setShowResetDialog(true)}>
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
            {subprocess && (
              <BpmnListEditor
                entityId={subprocess.id}
                entityType="subprocess"
                onSave={fetchSubprocessAndSteps}
              />
            )}
          </TabsContent>

          <TabsContent value="graphical">
            {subprocess && (
              <BpmnGraphicalEditor
                entityId={subprocess.id}
                entityType="subprocess"
                onSave={fetchSubprocessAndSteps}
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
              subprocess steps. This action cannot be undone.
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

      {/* Delete Step Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Step?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{stepToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setStepToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteStep} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Step Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Step</DialogTitle>
            <DialogDescription>
              Create a new step for this subprocess
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="stepName">Step Name *</Label>
              <Input
                id="stepName"
                placeholder="Enter step name"
                value={newStepName}
                onChange={(e) => setNewStepName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddStep();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stepDescription">Description (Optional)</Label>
              <Textarea
                id="stepDescription"
                placeholder="Enter step description"
                value={newStepDescription}
                onChange={(e) => setNewStepDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowAddDialog(false);
              setNewStepName("");
              setNewStepDescription("");
            }}>
              Cancel
            </Button>
            <Button onClick={handleAddStep}>
              Add Step
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          onOpenChange={setExportModalOpen}
          type={exportModalType}
          serviceId={service.id}
          serviceName={service.name}
        />
      )}
    </div>
  );
}
