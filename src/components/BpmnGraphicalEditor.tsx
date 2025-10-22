import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BpmnModeler from "bpmn-js/lib/Modeler";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2, Map } from "lucide-react";
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'diagram-js-minimap/assets/diagram-js-minimap.css';
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css';

interface BpmnGraphicalEditorProps {
  modeler: BpmnModeler;
  activeTab?: string;
}

export function BpmnGraphicalEditor({ modeler, activeTab }: BpmnGraphicalEditorProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const propertiesPanelRef = useRef<HTMLDivElement>(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const mountedRef = useRef(false);

  // Mount the modeler canvas to our container
  useEffect(() => {
    if (!containerRef.current || !propertiesPanelRef.current || mountedRef.current) return;

    try {
      // Attach canvas
      const canvas = modeler.get("canvas") as any;
      const container = containerRef.current;
      const modelerContainer = canvas._container;
      if (modelerContainer && !container.contains(modelerContainer)) {
        container.appendChild(modelerContainer);
      }
      canvas.zoom("fit-viewport");

      // Attach properties panel (guard against missing module)
      const propertiesPanel = modeler.get("propertiesPanel") as any;
      if (propertiesPanel?.attachTo && propertiesPanelRef.current) {
        propertiesPanel.attachTo(propertiesPanelRef.current);
      }
    } catch (error) {
      console.error("Error mounting BPMN editor:", error);
    }

    return () => {
      // Don't unmount on cleanup - keep the modeler attached
    };
  }, [modeler]);

  // Refresh canvas when switching to graphical tab and relayout connections if needed
  useEffect(() => {
    if (activeTab === "graphical" && modeler) {
      try {
        const canvas = modeler.get("canvas") as any;
        // Force canvas to redraw by clearing cached viewbox and refreshing
        canvas._cachedViewbox = null;
        const currentViewbox = canvas.viewbox();
        canvas.viewbox(currentViewbox);

        // Check if we need to relayout connections after a swap
        if ((modeler as any).__needsLayout) {
          const elementRegistry = modeler.get("elementRegistry") as any;
          const modeling = modeler.get("modeling") as any;
          
          // Get all connections
          const connections = elementRegistry.filter((el: any) => !!el.waypoints);
          
          // Relayout each connection
          connections.forEach((connection: any) => {
            try {
              modeling.layoutConnection(connection);
            } catch {
              try {
                modeling.updateWaypoints(connection, null);
              } catch (err) {
                console.warn("Failed to relayout connection:", connection.id, err);
              }
            }
          });

          // Clear the flag
          (modeler as any).__needsLayout = false;
          console.log("BpmnGraphicalEditor: Relayouted all connections after swap");
        }
      } catch (error) {
        console.error("Error refreshing canvas:", error);
      }
    }
  }, [activeTab, modeler]);

  // Zoom controls
  const handleZoomIn = () => {
    const canvas = modeler.get("canvas") as any;
    canvas.zoom(canvas.zoom() + 0.1);
  };

  const handleZoomOut = () => {
    const canvas = modeler.get("canvas") as any;
    canvas.zoom(canvas.zoom() - 0.1);
  };

  const handleFitViewport = () => {
    const canvas = modeler.get("canvas") as any;
    canvas.zoom("fit-viewport");
  };

  const handleToggleMinimap = () => {
    setShowMinimap(!showMinimap);
    const minimap = modeler.get("minimap") as any;
    if (minimap) {
      showMinimap ? minimap.close() : minimap.open();
    }
  };

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
    </div>
  );
}
