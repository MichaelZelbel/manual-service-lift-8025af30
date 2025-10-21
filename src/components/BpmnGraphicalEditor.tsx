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
}

export function BpmnGraphicalEditor({ modeler }: BpmnGraphicalEditorProps) {
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

      // Attach properties panel
      const propertiesPanel = modeler.get("propertiesPanel") as any;
      propertiesPanel.attachTo(propertiesPanelRef.current);

      mountedRef.current = true;
    } catch (error) {
      console.error("Error mounting BPMN editor:", error);
    }

    return () => {
      // Don't unmount on cleanup - keep the modeler attached
    };
  }, [modeler]);

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
