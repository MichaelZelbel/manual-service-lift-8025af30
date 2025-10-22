import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Code } from "lucide-react";
import { toast } from "sonner";
import { Form } from '@bpmn-io/form-js';
import '@bpmn-io/form-js/dist/assets/form-js.css';

interface FormPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileUrl: string;
  fileName: string;
}

export function FormPreviewModal({
  open,
  onOpenChange,
  fileUrl,
  fileName,
}: FormPreviewModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<any>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const formInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!open) return;

    const loadForm = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(fileUrl, { mode: 'cors', credentials: 'omit' });
        if (!response.ok) throw new Error('Failed to fetch form file');
        const text = await response.text();
        const json = JSON.parse(text);

        setFormData(json);
        setLoading(false);
      } catch (err) {
        console.error('Form preview error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load form');
        setLoading(false);
      }
    };

    loadForm();
  }, [open, fileUrl]);

  useEffect(() => {
    if (!open || !formData) return;
    let cancelled = false;

    const setup = async () => {
      try {
        // wait for container
        let tries = 0;
        while (!containerRef.current && tries < 20) {
          await new Promise((r) => setTimeout(r, 50));
          tries++;
          if (cancelled) return;
        }
        if (!containerRef.current) return;

        if (formInstanceRef.current) {
          formInstanceRef.current.destroy();
          formInstanceRef.current = null;
        }

        const form = new Form({ container: containerRef.current! });
        await form.importSchema(formData);
        formInstanceRef.current = form;
      } catch (e) {
        console.error('Form viewer error:', e);
        setError(e instanceof Error ? e.message : 'Failed to render form');
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (formInstanceRef.current) {
        formInstanceRef.current.destroy();
        formInstanceRef.current = null;
      }
    };
  }, [open, formData]);

  const handleCopyJson = () => {
    if (formData) {
      navigator.clipboard.writeText(JSON.stringify(formData, null, 2));
      toast.success('Form JSON copied to clipboard');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Form Preview: {fileName}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowRawJson(!showRawJson)}
              >
                <Code className="h-4 w-4 mr-2" />
                {showRawJson ? 'Show Structured' : 'Show Raw JSON'}
              </Button>
              <Button size="sm" variant="outline" onClick={handleCopyJson}>
                <Copy className="h-4 w-4 mr-2" />
                Copy JSON
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center h-[600px]">
            <div className="text-center space-y-2">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
              <p className="text-sm text-muted-foreground">Loading form...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-[600px]">
            <div className="text-center space-y-2">
              <p className="text-sm text-destructive">{error}</p>
              <p className="text-xs text-muted-foreground">
                The form JSON may be invalid or corrupted.
              </p>
              <Button variant="outline" onClick={() => setShowRawJson(true)}>
                View Raw JSON
              </Button>
            </div>
          </div>
        )}

        {!loading && !error && formData && (
          <ScrollArea className="h-[600px] border rounded-lg p-4">
            {showRawJson ? (
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {JSON.stringify(formData, null, 2)}
              </pre>
            ) : (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm mb-2">Form ID</h3>
                  <p className="text-sm text-muted-foreground">{formData.id || 'N/A'}</p>
                </div>

                {formData.title && (
                  <div>
                    <h3 className="font-semibold text-sm mb-2">Title</h3>
                    <p className="text-sm text-muted-foreground">{formData.title}</p>
                  </div>
                )}

                {formData.description && (
                  <div>
                    <h3 className="font-semibold text-sm mb-2">Description</h3>
                    <p className="text-sm text-muted-foreground">{formData.description}</p>
                  </div>
                )}

                {formData.fields && Array.isArray(formData.fields) && (
                  <div>
                    <h3 className="font-semibold text-sm mb-2">Fields ({formData.fields.length})</h3>
                    <div className="space-y-3">
                      {formData.fields.map((field: any, idx: number) => (
                        <div key={idx} className="bg-muted/50 p-3 rounded-lg">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-primary">
                              {field.type || 'unknown'}
                            </span>
                            {field.label && (
                              <span className="text-sm font-medium">{field.label}</span>
                            )}
                          </div>
                          {field.value && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Default: {field.value}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {formData.components && Array.isArray(formData.components) && (
                  <div>
                    <h3 className="font-semibold text-sm mb-2">
                      Components ({formData.components.length})
                    </h3>
                    <div className="space-y-2">
                      {formData.components.map((comp: any, idx: number) => (
                        <div key={idx} className="bg-muted/50 p-2 rounded text-xs">
                          <span className="font-medium">{comp.type || 'component'}</span>
                          {comp.label && <span className="ml-2 text-muted-foreground">- {comp.label}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
