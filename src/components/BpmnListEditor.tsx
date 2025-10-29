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
import { GripVertical, FileText, GitBranch, Share2, Box, Undo2, Trash2, Plus } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
interface BpmnElement {
  id: string;
  name: string;
  type: string;
  businessObject: any;
  incoming: any[];
  outgoing: any[];
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
interface BpmnListEditorProps {
  modeler: BpmnModeler;
  entityId: string;
  entityType: "service" | "subprocess";
}
interface SortableElementProps {
  element: BpmnElement;
  onShowConnections: (element: BpmnElement) => void;
  onEditSubprocess: (elementId: string) => void;
  canEditSubprocess: boolean;
  onDelete?: (elementId: string) => void;
  canDelete: boolean;
}
function SortableElement({
  element,
  onShowConnections,
  onEditSubprocess,
  canEditSubprocess,
  onDelete,
  canDelete
}: SortableElementProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: element.id
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
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
  return <div ref={setNodeRef} style={style} className="bg-card p-4 rounded-lg border border-border hover:border-primary hover:shadow-md transition-all duration-200 cursor-default">
      <div className="flex items-center gap-3">
        {/* Drag Handle */}
        <div {...attributes} {...listeners} className="flex-shrink-0 cursor-grab active:cursor-grabbing hover:text-primary transition-colors">
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
          <Button variant="outline" size="sm" onClick={() => onShowConnections(element)}>
            <Share2 className="h-4 w-4 mr-1" />
            Connections
          </Button>
          {canEditSubprocess && <Button variant="outline" size="sm" onClick={() => onEditSubprocess(element.id)}>
              Edit Subprocess
            </Button>}
          {canDelete && onDelete && (
            <Button variant="outline" size="sm" onClick={() => onDelete(element.id)} className="hover:bg-destructive/10 hover:text-destructive hover:border-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>;
}
export function BpmnListEditor({
  modeler,
  entityId,
  entityType
}: BpmnListEditorProps) {
  const navigate = useNavigate();
  const [elements, setElements] = useState<BpmnElement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedElement, setSelectedElement] = useState<BpmnElement | null>(null);
  const [newIncomingSource, setNewIncomingSource] = useState<string>("");
  const [newOutgoingTarget, setNewOutgoingTarget] = useState<string>("");
  const [createNodeDialogOpen, setCreateNodeDialogOpen] = useState(false);
  const [newNodeType, setNewNodeType] = useState<string>(entityType === "service" ? "bpmn:ExclusiveGateway" : "bpmn:UserTask");
  const [newNodeName, setNewNodeName] = useState<string>("");
  const tableName = entityType === "service" ? "manual_services" : "subprocesses";
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates
  }));

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

        const isIncludedTask = type === 'bpmn:Task' || type === 'bpmn:UserTask' || type === 'bpmn:ServiceTask' || type === 'bpmn:CallActivity'; // include CallActivity for main process steps

        const isIncludedGateway = type === 'bpmn:ExclusiveGateway' || type === 'bpmn:ParallelGateway' || type === 'bpmn:EventBasedGateway' || type === 'bpmn:InclusiveGateway';
        const isExcludedEvent = type === 'bpmn:StartEvent' || type === 'bpmn:EndEvent';
        const keep = (isIncludedTask || isIncludedGateway) && !isExcludedEvent;
        if (keep) {
          console.log('  ✓ Matched:', type, el.id);
        }
        return keep;
      });
      console.log("BpmnListEditor: Flow nodes (tasks + gateways):", flowNodes.length);

      // Sort by primary X (left-to-right), then Y for stability
      flowNodes.sort((a: any, b: any) => {
        const ax = a.x || 0;
        const bx = b.x || 0;
        if (ax !== bx) return ax - bx;
        const ay = a.y || 0;
        const by = b.y || 0;
        return ay - by;
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
          height: el.height || 80
        }
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

  // Parse elements on mount
  useEffect(() => {
    if (!modeler) return;
    try {
      setLoading(true);
      parseElements(modeler);
    } catch (error) {
      console.error("Error parsing elements:", error);
      toast.error("Failed to parse BPMN elements");
    } finally {
      setLoading(false);
    }
  }, [modeler, parseElements]);

  // Listen for modeler changes (e.g., after reset) and re-parse
  useEffect(() => {
    if (!modeler) return;
    
    const eventBus = modeler.get("eventBus") as any;
    const handleChange = () => {
      console.log("BpmnListEditor: Detected modeler change, re-parsing...");
      parseElements(modeler);
    };
    
    eventBus.on("commandStack.changed", handleChange);
    
    return () => {
      eventBus.off("commandStack.changed", handleChange);
    };
  }, [modeler, parseElements]);

  // Perform BPMN-aware swap by element IDs - capture all connections, delete, swap, recreate
  const performSwap = useCallback(async (idA: string, idB: string) => {
    if (!modeler || idA === idB) return;

    try {
      const modeling = modeler.get("modeling") as any;
      const elementRegistry = modeler.get("elementRegistry") as any;

      const shapeA = elementRegistry.get(idA);
      const shapeB = elementRegistry.get(idB);

      if (!shapeA || !shapeB) {
        throw new Error("Elements not found in registry");
      }

      console.log("BpmnListEditor: Swapping", idA, "<->", idB);

      // Helper: swap mapping for endpoints
      const mapEndpoint = (node: any) => (node === shapeA ? shapeB : node === shapeB ? shapeA : node);

      // Collect unique connections touching either shape
      const allFlows = [
        ...(shapeA.incoming || []),
        ...(shapeA.outgoing || []),
        ...(shapeB.incoming || []),
        ...(shapeB.outgoing || []),
      ];
      const uniqueFlows: any[] = Array.from(new Set(allFlows.map((f: any) => f.id))).map(
        (id) => allFlows.find((f: any) => f.id === id)
      );

      // Capture connection specs with properties we want to preserve
      type FlowSpec = {
        source: any;
        target: any;
        name?: string;
        conditionExpression?: any;
        wasDefault?: boolean;
      };
      const toRecreate: FlowSpec[] = uniqueFlows.map((flow: any) => {
        const src = flow.source;
        const tgt = flow.target;
        const bo = flow.businessObject || {};
        const srcBo = src?.businessObject;
        const wasDefault = !!(srcBo && srcBo.default && srcBo.default.id === bo.id);
        return {
          source: src,
          target: tgt,
          name: bo.name,
          conditionExpression: bo.conditionExpression,
          wasDefault,
        } as FlowSpec;
      });

      // Remove all existing connections
      uniqueFlows.forEach((flow: any) => modeling.removeConnection(flow));

      // Swap positions
      const deltaAB = { x: shapeB.x - shapeA.x, y: shapeB.y - shapeA.y };
      const deltaBA = { x: -deltaAB.x, y: -deltaAB.y };
      modeling.moveElements([shapeA], deltaAB);
      modeling.moveElements([shapeB], deltaBA);

      // Recreate all connections with swapped endpoints and preserved properties
      toRecreate.forEach((spec) => {
        const newSource = mapEndpoint(spec.source);
        const newTarget = mapEndpoint(spec.target);
        if (!newSource || !newTarget) return;
        try {
          const newConn = modeling.connect(newSource, newTarget);
          if (spec.name) {
            modeling.updateProperties(newConn, { name: spec.name });
          }
          if (spec.conditionExpression) {
            try {
              const moddle = modeler.get("moddle") as any;
              const cond = spec.conditionExpression;
              const recreated = moddle?.create?.(cond.$type, {
                body: cond.body,
                language: cond.language,
              }) || cond;
              newConn.businessObject.conditionExpression = recreated;
            } catch (e) {
              // best-effort
            }
          }
          if (spec.wasDefault) {
            try {
              modeling.updateProperties(newSource, { default: newConn.businessObject });
            } catch (e) {
              // ignore if not supported on this node type
            }
          }
        } catch (err) {
          console.warn(
            "Failed to recreate connection:",
            spec.source?.id,
            "->",
            spec.target?.id,
            err
          );
        }
      });

      // Mark that graphical editor needs relayout
      (modeler as any).__needsLayout = true;

      // Refresh list
      parseElements(modeler);
      const nameA = shapeA.businessObject?.name || idA;
      const nameB = shapeB.businessObject?.name || idB;
      toast.success(`Swapped '${nameA}' with '${nameB}'`);
    } catch (error) {
      console.error("Error performing swap:", error);
      toast.error("Swap failed");
      parseElements(modeler);
    }
  }, [modeler, parseElements]);

  // Handle drag end
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    console.log("Drag ended:", active.id, "->", over.id);
    await performSwap(String(active.id), String(over.id));
  };

  // Handle Edit Subprocess
  const handleEditSubprocess = async (elementId: string) => {
    try {
      const elementRegistry = modeler.get("elementRegistry") as any;
      const element = elementRegistry.get(elementId);
      
      if (!element || element.type !== "bpmn:CallActivity") {
        toast.error("Element is not a subprocess call");
        return;
      }

      // Get the step name from the BPMN element
      const stepName = element.businessObject?.name;
      if (!stepName) {
        toast.error("No step name found");
        return;
      }

      // Query the manual_service_steps table using the hard reference
      const { data: step, error } = await supabase
        .from("manual_service_steps")
        .select("subprocess_id")
        .eq("service_id", entityId)
        .eq("name", stepName)
        .maybeSingle();

      if (error) {
        console.error("Error querying step:", error);
        toast.error("Failed to find step in database");
        return;
      }

      if (!step?.subprocess_id) {
        toast.error("No subprocess linked to this step");
        return;
      }

      navigate(`/subprocess/${step.subprocess_id}?tab=list`);
    } catch (error) {
      console.error("Error navigating to subprocess:", error);
      toast.error("Failed to open subprocess");
    }
  };

  // Remove connection
  const handleRemoveConnection = useCallback((flowId: string) => {
    if (!modeler) return;
    try {
      const modeling = modeler.get("modeling") as any;
      const elementRegistry = modeler.get("elementRegistry") as any;
      const flow = elementRegistry.get(flowId);
      
      if (!flow) {
        toast.error("Connection not found");
        return;
      }
      
      modeling.removeConnection(flow);
      parseElements(modeler);
      
      // Update selected element to reflect changes
      if (selectedElement) {
        const updatedElement = elementRegistry.get(selectedElement.id);
        if (updatedElement) {
          setSelectedElement({
            ...selectedElement,
            incoming: updatedElement.incoming || [],
            outgoing: updatedElement.outgoing || []
          });
        }
      }
      
      toast.success("Connection removed");
    } catch (error) {
      console.error("Error removing connection:", error);
      toast.error("Failed to remove connection");
    }
  }, [modeler, parseElements, selectedElement]);

  // Add incoming connection
  const handleAddIncoming = useCallback(() => {
    if (!modeler || !selectedElement || !newIncomingSource) return;
    try {
      const modeling = modeler.get("modeling") as any;
      const elementRegistry = modeler.get("elementRegistry") as any;
      
      const sourceElement = elementRegistry.get(newIncomingSource);
      const targetElement = elementRegistry.get(selectedElement.id);
      
      if (!sourceElement || !targetElement) {
        toast.error("Elements not found");
        return;
      }
      
      modeling.connect(sourceElement, targetElement);
      parseElements(modeler);
      
      // Update selected element to reflect changes
      const updatedElement = elementRegistry.get(selectedElement.id);
      if (updatedElement) {
        setSelectedElement({
          ...selectedElement,
          incoming: updatedElement.incoming || [],
          outgoing: updatedElement.outgoing || []
        });
      }
      
      setNewIncomingSource("");
      toast.success("Connection added");
    } catch (error) {
      console.error("Error adding connection:", error);
      toast.error("Failed to add connection");
    }
  }, [modeler, parseElements, selectedElement, newIncomingSource]);

  // Add outgoing connection
  const handleAddOutgoing = useCallback(() => {
    if (!modeler || !selectedElement || !newOutgoingTarget) return;
    try {
      const modeling = modeler.get("modeling") as any;
      const elementRegistry = modeler.get("elementRegistry") as any;
      
      const sourceElement = elementRegistry.get(selectedElement.id);
      const targetElement = elementRegistry.get(newOutgoingTarget);
      
      if (!sourceElement || !targetElement) {
        toast.error("Elements not found");
        return;
      }
      
      modeling.connect(sourceElement, targetElement);
      parseElements(modeler);
      
      // Update selected element to reflect changes
      const updatedElement = elementRegistry.get(selectedElement.id);
      if (updatedElement) {
        setSelectedElement({
          ...selectedElement,
          incoming: updatedElement.incoming || [],
          outgoing: updatedElement.outgoing || []
        });
      }
      
      setNewOutgoingTarget("");
      toast.success("Connection added");
    } catch (error) {
      console.error("Error adding connection:", error);
      toast.error("Failed to add connection");
    }
  }, [modeler, parseElements, selectedElement, newOutgoingTarget]);

  // Undo
  const handleUndo = useCallback(() => {
    if (!modeler) return;
    const commandStack = modeler.get("commandStack") as any;
    if (commandStack.canUndo()) {
      commandStack.undo();
      parseElements(modeler);
      toast.success("Undone");
    } else {
      toast.info("Nothing to undo");
    }
  }, [modeler, parseElements]);

  // Delete node
  const handleDeleteNode = useCallback((elementId: string) => {
    if (!modeler) return;
    try {
      const modeling = modeler.get("modeling") as any;
      const elementRegistry = modeler.get("elementRegistry") as any;
      const element = elementRegistry.get(elementId);
      
      if (!element) {
        toast.error("Element not found");
        return;
      }
      
      const elementName = element.businessObject?.name || elementId;
      modeling.removeElements([element]);
      parseElements(modeler);
      toast.success(`Deleted '${elementName}'`);
    } catch (error) {
      console.error("Error deleting node:", error);
      toast.error("Failed to delete node");
    }
  }, [modeler, parseElements]);

  // Create new node
  const handleCreateNode = useCallback(() => {
    if (!modeler || !newNodeName.trim()) {
      toast.error("Please enter a node name");
      return;
    }
    
    try {
      const modeling = modeler.get("modeling") as any;
      const elementFactory = modeler.get("elementFactory") as any;
      const elementRegistry = modeler.get("elementRegistry") as any;
      const bpmnFactory = modeler.get("bpmnFactory") as any;
      
      // Find a good position for the new element (to the right of existing elements)
      const allElements = elementRegistry.getAll();
      let maxX = 200;
      allElements.forEach((el: any) => {
        if (el.x && el.x > maxX) {
          maxX = el.x;
        }
      });
      
      const position = { x: maxX + 150, y: 200 };
      
      // Create proper business object using bpmnFactory
      const businessObject = bpmnFactory.create(newNodeType, {
        name: newNodeName
      });
      
      // Create the shape with the proper business object
      const shape = elementFactory.createShape({
        type: newNodeType,
        businessObject: businessObject
      });
      
      // Get the process element (parent container)
      const process = elementRegistry.get("Process_Main") || 
                      elementRegistry.filter((el: any) => el.type === "bpmn:Process")[0];
      
      if (!process) {
        toast.error("Could not find process container");
        return;
      }
      
      // Add the shape to the diagram
      const newShape = modeling.createShape(shape, position, process);
      
      // Automatically connect to end event
      const endEvent = elementRegistry.filter((el: any) => el.type === "bpmn:EndEvent")[0];
      if (endEvent && newShape) {
        try {
          modeling.connect(newShape, endEvent);
        } catch (error) {
          console.warn("Could not auto-connect to end event:", error);
        }
      }
      
      parseElements(modeler);
      toast.success(`Created '${newNodeName}' and connected to end event`);
      
      // Reset dialog
      setCreateNodeDialogOpen(false);
      setNewNodeName("");
      setNewNodeType("bpmn:UserTask");
    } catch (error) {
      console.error("Error creating node:", error);
      toast.error("Failed to create node");
    }
  }, [modeler, newNodeName, newNodeType, parseElements]);

  // Get available elements for connections (excluding the selected element)
  const availableElements = elements.filter(el => el.id !== selectedElement?.id);

  // Filtered elements
  const filteredElements = (() => {
    if (!searchTerm) return elements;
    const term = searchTerm.toLowerCase();
    return elements.filter((el: BpmnElement) => el.name.toLowerCase().includes(term) || el.type.toLowerCase().includes(term));
  })();
  if (loading) {
    return <Card className="p-6">
        <p className="text-muted-foreground">Loading BPMN diagram...</p>
      </Card>;
  }
  return <div className="space-y-4">
      {/* Header */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            
            <p className="text-sm text-muted-foreground">
              Drag and drop to swap elements in the BPMN diagram. All connections
              are rewired automatically.
              {entityType === "subprocess" && " You can also create and delete nodes."}
              {entityType === "service" && " You can also add and delete gateways."}
            </p>
          </div>
          <div className="flex gap-2">
            {entityType === "subprocess" && (
              <Button variant="default" size="sm" onClick={() => setCreateNodeDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Node
              </Button>
            )}
            {entityType === "service" && (
              <Button variant="default" size="sm" onClick={() => setCreateNodeDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Gateway
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleUndo}>
              <Undo2 className="h-4 w-4 mr-2" />
              Undo
            </Button>
          </div>
        </div>
      </Card>

      {/* Search */}
      <Card className="p-4">
        <Input placeholder="Search by name or type..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full" />
      </Card>

      {/* List */}
      <Card className="p-6">
        {filteredElements.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">
            No elements found
          </p> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={filteredElements.map(el => el.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {filteredElements.map(element => <SortableElement key={element.id} element={element} onShowConnections={setSelectedElement} onEditSubprocess={handleEditSubprocess} canEditSubprocess={entityType === "service" && (element.type.includes("Task") || element.type === "bpmn:CallActivity")} onDelete={handleDeleteNode} canDelete={entityType === "subprocess" || (entityType === "service" && element.type.includes("Gateway"))} />)}
              </div>
            </SortableContext>
          </DndContext>}
      </Card>

      {/* Connections Dialog */}
      <Dialog open={!!selectedElement} onOpenChange={() => {
        setSelectedElement(null);
        setNewIncomingSource("");
        setNewOutgoingTarget("");
      }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Connections</DialogTitle>
            <DialogDescription>
              Manage connections for "{selectedElement?.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Incoming Connections */}
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">
                Incoming ({selectedElement?.incoming.length || 0})
              </h4>
              {selectedElement?.incoming.length === 0 ? <p className="text-sm text-muted-foreground mb-3">No incoming connections</p> : <div className="space-y-2 mb-3">
                  {selectedElement?.incoming.map((flow: any, idx: number) => <div key={idx} className="bg-muted/50 p-3 rounded border border-border text-sm flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">
                          From: {flow.source?.businessObject?.name || flow.source?.id}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          ID: {flow.id}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleRemoveConnection(flow.id)} className="flex-shrink-0 h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>)}
                </div>}
              
              {/* Add Incoming Connection */}
              <div className="flex gap-2">
                <Select value={newIncomingSource} onValueChange={setNewIncomingSource}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select source element..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableElements.map(el => <SelectItem key={el.id} value={el.id}>
                        {el.name || el.id}
                      </SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={handleAddIncoming} disabled={!newIncomingSource} size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
            </div>

            {/* Outgoing Connections */}
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">
                Outgoing ({selectedElement?.outgoing.length || 0})
              </h4>
              {selectedElement?.outgoing.length === 0 ? <p className="text-sm text-muted-foreground mb-3">No outgoing connections</p> : <div className="space-y-2 mb-3">
                  {selectedElement?.outgoing.map((flow: any, idx: number) => <div key={idx} className="bg-muted/50 p-3 rounded border border-border text-sm flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">
                          To: {flow.target?.businessObject?.name || flow.target?.id}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          ID: {flow.id}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleRemoveConnection(flow.id)} className="flex-shrink-0 h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>)}
                </div>}
              
              {/* Add Outgoing Connection */}
              <div className="flex gap-2">
                <Select value={newOutgoingTarget} onValueChange={setNewOutgoingTarget}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select target element..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableElements.map(el => <SelectItem key={el.id} value={el.id}>
                        {el.name || el.id}
                      </SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={handleAddOutgoing} disabled={!newOutgoingTarget} size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Node Dialog */}
      <Dialog open={createNodeDialogOpen} onOpenChange={setCreateNodeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{entityType === "service" ? "Add Gateway" : "Create New Node"}</DialogTitle>
            <DialogDescription>
              {entityType === "service" 
                ? "Choose the gateway type and enter a name for the new gateway."
                : "Choose the node type and enter a name for the new element."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{entityType === "service" ? "Gateway Type" : "Node Type"}</label>
              <Select value={newNodeType} onValueChange={setNewNodeType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {entityType === "subprocess" && (
                    <>
                      <SelectItem value="bpmn:UserTask">User Task</SelectItem>
                      <SelectItem value="bpmn:ServiceTask">Service Task</SelectItem>
                      <SelectItem value="bpmn:Task">Task</SelectItem>
                    </>
                  )}
                  <SelectItem value="bpmn:ExclusiveGateway">XOR Gateway (Exclusive)</SelectItem>
                  <SelectItem value="bpmn:ParallelGateway">AND Gateway (Parallel)</SelectItem>
                  <SelectItem value="bpmn:InclusiveGateway">OR Gateway (Inclusive)</SelectItem>
                  <SelectItem value="bpmn:EventBasedGateway">Event Gateway</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{entityType === "service" ? "Gateway Name" : "Node Name"}</label>
              <Input 
                placeholder={entityType === "service" ? "Enter gateway name..." : "Enter node name..."} 
                value={newNodeName} 
                onChange={(e) => setNewNodeName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreateNode();
                  }
                }}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => {
              setCreateNodeDialogOpen(false);
              setNewNodeName("");
              setNewNodeType(entityType === "service" ? "bpmn:ExclusiveGateway" : "bpmn:UserTask");
            }}>
              Cancel
            </Button>
            <Button onClick={handleCreateNode} disabled={!newNodeName.trim()}>
              {entityType === "service" ? "Add" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>;
}