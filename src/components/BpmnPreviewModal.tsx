import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import BpmnViewer from "bpmn-js/lib/Viewer";
import { toast } from "sonner";

interface BpmnPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileUrl: string;
  fileName: string;
}

export function BpmnPreviewModal({
  open,
  onOpenChange,
  fileUrl,
  fileName,
}: BpmnPreviewModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<BpmnViewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !containerRef.current) return;

    const loadBpmn = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch BPMN XML
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error('Failed to fetch BPMN file');
        const xml = await response.text();

        // Create viewer
        const viewer = new BpmnViewer({
          container: containerRef.current!,
          height: 600,
        });

        viewerRef.current = viewer;

        // Import XML
        await viewer.importXML(xml);
        
        // Fit to viewport
        const canvas = viewer.get('canvas') as any;
        canvas.zoom('fit-viewport');

        setLoading(false);
      } catch (err) {
        console.error('BPMN preview error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load BPMN diagram');
        setLoading(false);
      }
    };

    loadBpmn();

    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [open, fileUrl]);

  const handleZoomIn = () => {
    if (viewerRef.current) {
      const canvas = viewerRef.current.get('canvas') as any;
      canvas.zoom(canvas.zoom() + 0.1);
    }
  };

  const handleZoomOut = () => {
    if (viewerRef.current) {
      const canvas = viewerRef.current.get('canvas') as any;
      canvas.zoom(canvas.zoom() - 0.1);
    }
  };

  const handleFitViewport = () => {
    if (viewerRef.current) {
      const canvas = viewerRef.current.get('canvas') as any;
      canvas.zoom('fit-viewport');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>BPMN Preview: {fileName}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleZoomOut}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" onClick={handleZoomIn}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" onClick={handleFitViewport}>
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center h-[600px]">
            <div className="text-center space-y-2">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
              <p className="text-sm text-muted-foreground">Loading BPMN diagram...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-[600px]">
            <div className="text-center space-y-2">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        )}

        <div
          ref={containerRef}
          className={`border rounded-lg ${loading || error ? 'hidden' : ''}`}
          style={{ height: '600px' }}
        />
      </DialogContent>
    </Dialog>
  );
}
