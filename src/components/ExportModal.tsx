import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, Download } from "lucide-react";
import { toast } from "sonner";
import { ExportResultsPanel } from "./ExportResultsPanel";

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "export" | "analysis";
  serviceId: string;
  serviceName: string;
  bpmnModeler?: any; // bpmn-js Modeler instance (required for export)
}

const PROGRESS_STEPS = {
  export: [
    { message: "Analyzing process structure...", duration: 800 },
    { message: "Generating BPMN 2.0 layout...", duration: 1000 },
    { message: "Linking subprocess BPMNs...", duration: 900 },
    { message: "Exporting forms...", duration: 700 },
    { message: "Preparing download package...", duration: 600 },
  ],
  analysis: [
    { message: "Analyzing process structure...", duration: 900 },
    { message: "Identifying automation opportunities...", duration: 1100 },
    { message: "Calculating efficiency metrics...", duration: 800 },
    { message: "Generating Change Report...", duration: 1000 },
  ],
};

export function ExportModal({
  open,
  onOpenChange,
  type,
  serviceId,
  serviceName,
  bpmnModeler,
}: ExportModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);

  const handleClose = () => {
    if (!isProcessing) {
      onOpenChange(false);
      // Reset state after modal animation
      setTimeout(() => {
        setIsComplete(false);
        setProgress(0);
        setCurrentStep("");
        setDownloadUrl(null);
        setShowResults(false);
      }, 200);
    }
  };

  const simulateProgress = async (steps: typeof PROGRESS_STEPS.export) => {
    const totalDuration = steps.reduce((sum, step) => sum + step.duration, 0);
    let elapsed = 0;

    for (const step of steps) {
      setCurrentStep(step.message);
      const startProgress = (elapsed / totalDuration) * 100;
      const endProgress = ((elapsed + step.duration) / totalDuration) * 100;

      // Animate progress smoothly
      const animationSteps = 20;
      const stepIncrement = (endProgress - startProgress) / animationSteps;
      const stepDelay = step.duration / animationSteps;

      for (let i = 0; i < animationSteps; i++) {
        await new Promise((resolve) => setTimeout(resolve, stepDelay));
        setProgress(startProgress + stepIncrement * (i + 1));
      }

      elapsed += step.duration;
    }
  };

  const handleStartExport = async () => {
    setIsProcessing(true);
    setProgress(0);

    try {
      // Simulate progress
      const steps = type === "export" ? PROGRESS_STEPS.export : PROGRESS_STEPS.analysis;
      const progressPromise = simulateProgress(steps);

      let exportFolder: string | null = null;
      let downloadUrl: string | null = null;

      if (type === "export") {
        // Check if modeler is available
        if (!bpmnModeler) {
          throw new Error("BPMN Modeler instance not available");
        }

        // Load form templates and generate bundle
        const { generateAndUploadBundle } = await import("../actions/generateForCamunda.js");
        const { loadFormTemplates } = await import("../utils/loadFormTemplates.js");
        
        const templates = await loadFormTemplates();
        const result = await generateAndUploadBundle({
          serviceId,
          serviceName,
          bpmnModeler,
          templates,
        });

        exportFolder = result.exportFolder;
        
        toast.success(`Generated ${result.formsCount} forms and ${result.subprocessCount} subprocess BPMNs`);
      } else {
        // Analysis - keep mock for now
        const filename = `${serviceName.replace(/\s+/g, "_")}_Analysis_Report.pdf`;
        downloadUrl = `https://example.com/downloads/${filename}`;
      }

      // Wait for progress animation to complete
      await progressPromise;

      if (downloadUrl) {
        setDownloadUrl(downloadUrl);
      }
      setIsComplete(true);
      
      // Show results panel for export
      if (type === "export" && exportFolder) {
        setShowResults(true);
      }
      
      toast.success(
        type === "export"
          ? "Export completed successfully!"
          : "Analysis completed successfully!"
      );
    } catch (error) {
      console.error("Export error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to complete export");
      handleClose();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (downloadUrl) {
      // Open download URL in new tab
      window.open(downloadUrl, '_blank');
      toast.success("Download started");
    }
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={showResults ? "sm:max-w-[900px]" : "sm:max-w-[520px]"}>
        <DialogHeader>
          <DialogTitle>
            {type === "export" ? "Export Options" : "Run Backend Analysis"}
          </DialogTitle>
          <DialogDescription>
            {type === "export"
              ? "We'll generate the Manual Service BPMN and one BPMN per subprocess. The Manual Service BPMN will be enriched (FEEL conditions & form bindings). Webforms are generated for the Manual Service start node and each process step. Everything is packaged and ready for Camunda import."
              : "Analyze the process for automation opportunities and generate a Change Report."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {!isProcessing && !isComplete && (
            <>
              {type === "export" && (
                <div className="bg-muted/50 p-4 rounded-lg">
                  <p className="text-sm text-foreground">
                    The export will include:
                  </p>
                  <ul className="list-disc list-inside text-sm text-muted-foreground mt-2 space-y-1">
                    <li><strong>Main BPMN</strong>: Enriched with FEEL conditions and form bindings</li>
                    <li><strong>Subprocess BPMNs</strong>: One per subprocess (unchanged)</li>
                    <li><strong>Forms</strong>: Generated for Manual Service start and user tasks</li>
                    <li><strong>Manifest</strong>: Mapping of forms to process nodes</li>
                  </ul>
                </div>
              )}

              {type === "analysis" && (
                <div className="bg-muted/50 p-4 rounded-lg">
                  <p className="text-sm text-foreground">
                    The system will analyze the process for automation opportunities and
                    generate a detailed Change Report (CR) with recommendations.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button onClick={handleStartExport}>
                  {type === "export" ? "Start Export" : "Start Analysis"}
                </Button>
              </div>
            </>
          )}

          {isProcessing && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-muted-foreground text-center animate-pulse">
                  {currentStep}
                </p>
              </div>
            </div>
          )}

          {isComplete && !showResults && (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center py-6 space-y-3">
                <CheckCircle2 className="h-16 w-16 text-green-600" />
                <p className="text-lg font-semibold text-foreground">
                  {type === "export" ? "Export completed successfully!" : "Analysis completed successfully!"}
                </p>
                <p className="text-sm text-muted-foreground text-center">
                  Your {type === "export" ? "package" : "report"} is ready.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={handleClose}>
                  Close
                </Button>
                {type === "export" ? (
                  <Button onClick={() => setShowResults(true)}>
                    View Generated Files
                  </Button>
                ) : (
                  <Button onClick={handleDownload}>
                    <Download className="h-4 w-4 mr-2" />
                    Download Report (.pdf)
                  </Button>
                )}
              </div>
            </div>
          )}

          {isComplete && showResults && type === "export" && (
            <div className="space-y-4">
              <ScrollArea className="max-h-[60vh]">
                <ExportResultsPanel 
                  serviceId={serviceId}
                  serviceName={serviceName}
                />
              </ScrollArea>
              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={handleClose}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
