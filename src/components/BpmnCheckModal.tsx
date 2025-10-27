import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";

interface BpmnCheckModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  assessment: string | null;
  error: string | null;
}

export function BpmnCheckModal({
  open,
  onOpenChange,
  loading,
  assessment,
  error,
}: BpmnCheckModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Process Check</DialogTitle>
        </DialogHeader>
        
        <div className="min-h-[300px] max-h-[400px]">
          {loading && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Analysing...</p>
            </div>
          )}
          
          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-destructive font-medium mb-2">Error</p>
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
          )}
          
          {assessment && !loading && (
            <ScrollArea className="h-full pr-4">
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown>{assessment}</ReactMarkdown>
              </div>
            </ScrollArea>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
