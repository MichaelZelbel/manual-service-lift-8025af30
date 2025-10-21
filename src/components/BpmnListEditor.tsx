import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import BpmnModeler from "bpmn-js/lib/Modeler";
// @ts-ignore - zeebe moddle doesn't have types
import zeebeModdle from "zeebe-bpmn-moddle/resources/zeebe.json";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  GripVertical,
  FileText,
  GitBranch,
  Share2,
  Box,
  Undo2,
} from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";


interface BpmnElement {
  id: string;
  name: string;
  type: string;
  businessObject: any;
  incoming: any[];
  outgoing: any[];
  bounds: { x: number; y: number; width: number; height: number };
}

interface BpmnListEditorProps {
  entityId: string;
  entityType: "service" | "subprocess";
  onSave?: () => void;
}

interface SortableElementProps {
  element: BpmnElement;
  onShowConnections: (element: BpmnElement) => void;
  onEditSubprocess: (elementId: string) => void;
  canEditSubprocess: boolean;
}

function SortableElement({
  element,
  onShowConnections,
  onEditSubprocess,
  canEditSubprocess,
}: SortableElementProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: element.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const getIcon = () => {
    if (element.type.includes("Task")) return <FileText className="h-5 w-5" />;
    if (element.type.includes("Gateway")) return <GitBranch className="h-5 w-5" />;
    return <Box className="h-5 w-5" />;
  };

  const getTypeBadge = () => {
    if (element.type === "bpmn:UserTask") return "User Task";
    if (element.type === "bpmn:ServiceTask") return "Service Task";
    if (element.type === "bpmn:ExclusiveGateway") return "XOR Gateway";
    if (element.type === "bpmn:ParallelGateway") return "AND Gateway";
    if (element.type === "bpmn:EventBasedGateway") return "Event Gateway";
    if (element.type === "bpmn:InclusiveGateway") return "OR Gateway";
    return element.type.replace("bpmn:", "");
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-card p-4 rounded-lg border border-border hover:border-primary hover:shadow-md transition-all duration-200 cursor-default"
    >
      <div className="flex items-center gap-3">
        {/* Drag Handle */}
        <div
          {...attributes}
          {...listeners}
          className="flex-shrink-0 cursor-grab active:cursor-grabbing hover:text-primary transition-colors"
        >
          <GripVertical className="h-5 w-5 text-[#A0A0A0]" />
        </div>

        {/* Icon */}
        <div className="flex-shrink-0 text-primary">{getIcon()}</div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-foreground truncate">
              {element.name || element.id}
            </h3>
            <Badge variant="secondary" className="text-xs">
              {getTypeBadge()}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {element.incoming.length} incoming, {element.outgoing.length}{" "}
            outgoing
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onShowConnections(element)}
          >
            <Share2 className="h-4 w-4 mr-1" />
            Connections
          </Button>
          {canEditSubprocess && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEditSubprocess(element.id)}
            >
              Edit Subprocess
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function BpmnListEditor({
  entityId,
  entityType,
  onSave,
}: BpmnListEditorProps) {
  const navigate = useNavigate();
  const [modeler, setModeler] = useState<BpmnModeler | null>(null);
  const [elements, setElements] = useState<BpmnElement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedElement, setSelectedElement] = useState<BpmnElement | null>(
    null
  );
  const [lastSaveTime, setLastSaveTime] = useState<NodeJS.Timeout | null>(null);

  const tableName = entityType === "service" ? "manual_services" : "subprocesses";

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Initialize headless modeler
  useEffect(() => {
    const initModeler = async () => {
      try {
        console.log("BpmnListEditor: Initializing for", entityType, entityId);
        setLoading(true);
        
        // Create headless modeler without keyboard binding
        const mod = new BpmnModeler({
          container: document.createElement("div"),
          moddleExtensions: { zeebe: zeebeModdle as any },
        });
        setModeler(mod);
        console.log("BpmnListEditor: Modeler created");

        // Load BPMN
        console.log("BpmnListEditor: Loading from table", tableName);
        const { data, error } = await supabase
          .from(tableName)
          .select("original_bpmn_xml, edited_bpmn_xml")
          .eq("id", entityId)
          .single();

        if (error) {
          console.error("BpmnListEditor: Database error", error);
          throw error;
        }

        console.log("BpmnListEditor: Data fetched", {
          hasOriginal: !!data?.original_bpmn_xml,
          hasEdited: !!data?.edited_bpmn_xml
        });

        const xmlToLoad =
          data.edited_bpmn_xml || data.original_bpmn_xml || "";
        if (!xmlToLoad) {
          console.error("BpmnListEditor: No XML data found");
          toast.error("No BPMN diagram found");
          setLoading(false);
          return;
        }

        console.log("BpmnListEditor: Importing XML, length:", xmlToLoad.length);
        await mod.importXML(xmlToLoad);
        console.log("BpmnListEditor: XML imported successfully");
        
        parseElements(mod);
        console.log("BpmnListEditor: Elements parsed");
      } catch (error) {
        console.error("BpmnListEditor: Error initializing modeler:", error);
        toast.error("Failed to load BPMN diagram");
      } finally {
        setLoading(false);
      }
    };

    initModeler();

    return () => {
      if (lastSaveTime) clearTimeout(lastSaveTime);
    };
  }, [entityId, entityType]);

  // Parse elements from BPMN
  const parseElements = useCallback((mod: BpmnModeler) => {
    try {
      console.log("BpmnListEditor: Parsing elements...");
      const elementRegistry = mod.get("elementRegistry") as any;
      const allElements = elementRegistry.getAll();
      console.log("BpmnListEditor: Total elements found:", allElements.length);

      // Log all element types to debug
      allElements.forEach((el: any, idx: number) => {
        console.log(`  Element ${idx}: type="${el.type}", id="${el.id}", name="${el.businessObject?.name || 'N/A'}"`);
      });

      const flowNodes = allElements.filter((el: any) => {
        const type = el.type as string | undefined;
        if (!type) return false;
        if (el.labelTarget || type === 'label') return false; // exclude labels

        const isIncludedTask =
          type === 'bpmn:Task' ||
          type === 'bpmn:UserTask' ||
          type === 'bpmn:ServiceTask' ||
          type === 'bpmn:CallActivity'; // include CallActivity for main process steps

        const isIncludedGateway =
          type === 'bpmn:ExclusiveGateway' ||
          type === 'bpmn:ParallelGateway' ||
          type === 'bpmn:EventBasedGateway' ||
          type === 'bpmn:InclusiveGateway';

        const isExcludedEvent = type === 'bpmn:StartEvent' || type === 'bpmn:EndEvent';

        const keep = (isIncludedTask || isIncludedGateway) && !isExcludedEvent;
        if (keep) {
          console.log('  ✓ Matched:', type, el.id);
        }
        return keep;
      });

      console.log("BpmnListEditor: Flow nodes (tasks + gateways):", flowNodes.length);

      // Sort by y-coordinate
      flowNodes.sort((a: any, b: any) => {
        const aY = a.y || 0;
        const bY = b.y || 0;
        return aY - bY;
      });

      const parsed: BpmnElement[] = flowNodes.map((el: any) => ({
        id: el.id,
        name: el.businessObject.name || el.id,
        type: el.type,
        businessObject: el.businessObject,
        incoming: el.incoming || [],
        outgoing: el.outgoing || [],
        bounds: {
          x: el.x || 0,
          y: el.y || 0,
          width: el.width || 100,
          height: el.height || 80,
        },
      }));

      console.log("BpmnListEditor: Parsed elements:", parsed.length);
      parsed.forEach((el, idx) => {
        console.log(`  ${idx + 1}. ${el.name} (${el.type})`);
      });

      setElements(parsed);
    } catch (error) {
      console.error("BpmnListEditor: Error parsing elements:", error);
      toast.error("Failed to parse BPMN elements");
    }
  }, []);

  // Listen for changes from other editors
  useEffect(() => {
    let lastUpdate = localStorage.getItem(`bpmn_updated_${entityId}`);
    let myLastSave = localStorage.getItem(`bpmn_my_save_${entityId}_list`);
    
    const checkForUpdates = setInterval(() => {
      const currentUpdate = localStorage.getItem(`bpmn_updated_${entityId}`);
      const currentMyLastSave = localStorage.getItem(`bpmn_my_save_${entityId}_list`);
      
      // Only reload if the update is from another editor (not my own save)
      if (currentUpdate && currentUpdate !== lastUpdate && currentUpdate !== currentMyLastSave && modeler) {
        lastUpdate = currentUpdate;
        myLastSave = currentMyLastSave;
        // Reload BPMN from database
        supabase
          .from(tableName)
          .select("edited_bpmn_xml, original_bpmn_xml")
          .eq("id", entityId)
          .single()
          .then(({ data, error }) => {
            if (error || !data) return;
            const xml = data.edited_bpmn_xml || data.original_bpmn_xml;
            if (xml) {
              modeler.importXML(xml).then(() => {
                parseElements(modeler);
                toast.info("Updated from Graphical Editor");
              });
            }
          });
      }
    }, 500);

    return () => clearInterval(checkForUpdates);
  }, [entityId, modeler, tableName, parseElements]);

  // Debounced save
  const saveBpmn = useCallback(async () => {
    if (!modeler) return;
    try {
      const { xml } = await modeler.saveXML({ format: true });
      if (!xml || !xml.includes("<bpmn:definitions")) {
        throw new Error("Invalid BPMN XML");
      }

      const { error } = await supabase
        .from(tableName)
        .update({ edited_bpmn_xml: xml })
        .eq("id", entityId);

      if (error) throw error;
      
      // Signal other editors to reload, but mark it as my save
      const timestamp = Date.now().toString();
      localStorage.setItem(`bpmn_updated_${entityId}`, timestamp);
      localStorage.setItem(`bpmn_my_save_${entityId}_list`, timestamp);
      
      toast.success("Changes saved");
      onSave?.();
    } catch (error) {
      console.error("Error saving BPMN:", error);
      toast.error("Failed to save changes");
    }
  }, [modeler, entityId, tableName, onSave]);

  const debouncedSave = useCallback(() => {
    if (lastSaveTime) clearTimeout(lastSaveTime);
    const timeout = setTimeout(() => {
      saveBpmn();
    }, 1200);
    setLastSaveTime(timeout);
  }, [saveBpmn, lastSaveTime]);

  // Perform BPMN-aware swap
  const performSwap = useCallback(
    async (indexA: number, indexB: number) => {
      if (!modeler) return;

      const elA = elements[indexA];
      const elB = elements[indexB];

      try {
        const modeling = modeler.get("modeling") as any;
        const elementRegistry = modeler.get("elementRegistry") as any;

        const shapeA = elementRegistry.get(elA.id);
        const shapeB = elementRegistry.get(elB.id);

        if (!shapeA || !shapeB) {
          throw new Error("Elements not found in registry");
        }

        // Get current connections (clone arrays to avoid modification during iteration)
        const incomingA = [...(shapeA.incoming || [])];
        const outgoingA = [...(shapeA.outgoing || [])];
        const incomingB = [...(shapeB.incoming || [])];
        const outgoingB = [...(shapeB.outgoing || [])];

        // Identify direct connections between A and B
        const flowsAtoB = outgoingA.filter((flow: any) => flow.target === shapeB);
        const flowsBtoA = outgoingB.filter((flow: any) => flow.target === shapeA);

        // Reconnect incoming flows (excluding direct connections between A and B)
        incomingA.forEach((flow: any) => {
          if (flow.source !== shapeB) {
            modeling.reconnectEnd(flow, shapeB, flow.waypoints[flow.waypoints.length - 1]);
          }
        });
        incomingB.forEach((flow: any) => {
          if (flow.source !== shapeA) {
            modeling.reconnectEnd(flow, shapeA, flow.waypoints[flow.waypoints.length - 1]);
          }
        });

        // Reconnect outgoing flows (excluding direct connections between A and B)
        outgoingA.forEach((flow: any) => {
          if (flow.target !== shapeB) {
            modeling.reconnectStart(flow, shapeB, flow.waypoints[0]);
          }
        });
        outgoingB.forEach((flow: any) => {
          if (flow.target !== shapeA) {
            modeling.reconnectStart(flow, shapeA, flow.waypoints[0]);
          }
        });

        // Handle direct connections: A->B becomes B->A and vice versa
        flowsAtoB.forEach((flow: any) => {
          modeling.reconnectStart(flow, shapeB, flow.waypoints[0]);
          modeling.reconnectEnd(flow, shapeA, flow.waypoints[flow.waypoints.length - 1]);
        });
        flowsBtoA.forEach((flow: any) => {
          modeling.reconnectStart(flow, shapeA, flow.waypoints[0]);
          modeling.reconnectEnd(flow, shapeB, flow.waypoints[flow.waypoints.length - 1]);
        });

        // Swap positions
        const deltaAB = {
          x: shapeB.x - shapeA.x,
          y: shapeB.y - shapeA.y,
        };
        const deltaBA = {
          x: shapeA.x - shapeB.x,
          y: shapeA.y - shapeB.y,
        };

        modeling.moveElements([shapeA], deltaAB);
        modeling.moveElements([shapeB], deltaBA);

        // Re-parse to update local state with new connections
        parseElements(modeler);

        toast.success(`Swapped '${elA.name}' with '${elB.name}'`);
        debouncedSave();
      } catch (error) {
        console.error("Error performing swap:", error);
        toast.error("Swap failed - reverting");
        // Reload from database on error
        const { data } = await supabase
          .from(tableName)
          .select("edited_bpmn_xml, original_bpmn_xml")
          .eq("id", entityId)
          .single();
        if (data) {
          const xml = data.edited_bpmn_xml || data.original_bpmn_xml;
          if (xml) {
            await modeler.importXML(xml);
            parseElements(modeler);
          }
        }
      }
    },
    [modeler, elements, debouncedSave, parseElements, tableName, entityId]
  );

  // Handle drag end
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = elements.findIndex((el) => el.id === active.id);
    const newIndex = elements.findIndex((el) => el.id === over.id);

    await performSwap(oldIndex, newIndex);
  };

  // Handle Edit Subprocess - Simplified to avoid type issues
  const handleEditSubprocess = async (elementId: string) => {
    toast.info("Subprocess navigation coming soon");
  };

  // Undo
  const handleUndo = useCallback(() => {
    if (!modeler) return;
    const commandStack = modeler.get("commandStack") as any;
    if (commandStack.canUndo()) {
      commandStack.undo();
      parseElements(modeler);
      debouncedSave();
      toast.success("Undone");
    } else {
      toast.info("Nothing to undo");
    }
  }, [modeler, parseElements, debouncedSave]);

  // Filtered elements
  const filteredElements = (() => {
    if (!searchTerm) return elements;
    const term = searchTerm.toLowerCase();
    return elements.filter(
      (el: BpmnElement) =>
        el.name.toLowerCase().includes(term) ||
        el.type.toLowerCase().includes(term)
    );
  })();

  if (loading) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">Loading BPMN diagram...</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-foreground mb-1">
              List Editor (BPMN-aware)
            </h2>
            <p className="text-sm text-muted-foreground">
              Drag and drop to swap elements in the BPMN diagram. All connections
              are rewired automatically.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleUndo}>
            <Undo2 className="h-4 w-4 mr-2" />
            Undo
          </Button>
        </div>
      </Card>

      {/* Search */}
      <Card className="p-4">
        <Input
          placeholder="Search by name or type..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full"
        />
      </Card>

      {/* List */}
      <Card className="p-6">
        {filteredElements.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No elements found
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredElements.map((el) => el.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3">
                {filteredElements.map((element) => (
                  <SortableElement
                    key={element.id}
                    element={element}
                    onShowConnections={setSelectedElement}
                    onEditSubprocess={handleEditSubprocess}
                    canEditSubprocess={entityType === "service"}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </Card>

      {/* Connections Dialog */}
      <Dialog
        open={!!selectedElement}
        onOpenChange={() => setSelectedElement(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connections</DialogTitle>
            <DialogDescription>
              Connections for "{selectedElement?.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">
                Incoming ({selectedElement?.incoming.length || 0})
              </h4>
              {selectedElement?.incoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">No incoming connections</p>
              ) : (
                <div className="space-y-2">
                  {selectedElement?.incoming.map((flow: any, idx: number) => (
                    <div
                      key={idx}
                      className="bg-muted/50 p-2 rounded border border-border text-sm"
                    >
                      <p className="font-medium">
                        From: {flow.source?.businessObject?.name || flow.source?.id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        ID: {flow.id}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">
                Outgoing ({selectedElement?.outgoing.length || 0})
              </h4>
              {selectedElement?.outgoing.length === 0 ? (
                <p className="text-sm text-muted-foreground">No outgoing connections</p>
              ) : (
                <div className="space-y-2">
                  {selectedElement?.outgoing.map((flow: any, idx: number) => (
                    <div
                      key={idx}
                      className="bg-muted/50 p-2 rounded border border-border text-sm"
                    >
                      <p className="font-medium">
                        To: {flow.target?.businessObject?.name || flow.target?.id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        ID: {flow.id}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
