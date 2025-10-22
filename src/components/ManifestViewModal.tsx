import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy } from "lucide-react";
import { toast } from "sonner";

interface ManifestViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manifest: any;
}

export function ManifestViewModal({
  open,
  onOpenChange,
  manifest,
}: ManifestViewModalProps) {
  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(manifest, null, 2));
    toast.success('Manifest copied to clipboard');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Manifest JSON</span>
            <Button size="sm" variant="outline" onClick={handleCopyJson}>
              <Copy className="h-4 w-4 mr-2" />
              Copy JSON
            </Button>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[600px] border rounded-lg p-4">
          <pre className="text-xs font-mono whitespace-pre-wrap">
            {JSON.stringify(manifest, null, 2)}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
