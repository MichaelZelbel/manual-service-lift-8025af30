import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "export" | "analysis";
  serviceId: string;
  serviceName: string;
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
}: ExportModalProps) {
  const [generateBpmn, setGenerateBpmn] = useState(true);
  const [generateForms, setGenerateForms] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const handleClose = () => {
    if (!isProcessing) {
      onOpenChange(false);
      // Reset state after modal animation
      setTimeout(() => {
        setIsComplete(false);
        setProgress(0);
        setCurrentStep("");
        setDownloadUrl(null);
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
      // Create export record
      const exportType = type === "export" ? "bpmn" : "analysis";
      const { data: exportRecord, error: exportError } = await supabase
        .from("exports")
        .insert({
          service_id: serviceId,
          type: exportType,
          status: "processing",
        })
        .select()
        .single();

      if (exportError) throw exportError;

      // Simulate progress
      const steps = type === "export" ? PROGRESS_STEPS.export : PROGRESS_STEPS.analysis;
      await simulateProgress(steps);

      // Generate mock download URL
      const filename = type === "export"
        ? `${serviceName.replace(/\s+/g, "_")}_BPMN_Package.zip`
        : `${serviceName.replace(/\s+/g, "_")}_Analysis_Report.pdf`;
      const mockUrl = `https://example.com/downloads/${filename}`;

      // Update export record
      await supabase
        .from("exports")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          download_url: mockUrl,
        })
        .eq("id", exportRecord.id);

      // Update service timestamp
      const updateField = type === "export" ? "last_bpmn_export" : "last_analysis";
      await supabase
        .from("manual_services")
        .update({ [updateField]: new Date().toISOString() })
        .eq("id", serviceId);

      setDownloadUrl(mockUrl);
      setIsComplete(true);
      toast.success(
        type === "export"
          ? "Export completed successfully!"
          : "Analysis completed successfully!"
      );
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to complete export");
      handleClose();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    // In production, this would trigger actual file download
    toast.success("Download started (simulated)");
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {type === "export" ? "Export Options" : "Run Backend Analysis"}
          </DialogTitle>
          <DialogDescription>
            {type === "export"
              ? "Select the files you want to generate for Camunda import."
              : "Analyze the process for automation opportunities and generate a Change Report."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {!isProcessing && !isComplete && (
            <>
              {type === "export" && (
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="bpmn"
                      checked={generateBpmn}
                      onCheckedChange={(checked) => setGenerateBpmn(checked as boolean)}
                    />
                    <label
                      htmlFor="bpmn"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Generate BPMN 2.0 files
                    </label>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="forms"
                      checked={generateForms}
                      onCheckedChange={(checked) => setGenerateForms(checked as boolean)}
                    />
                    <label
                      htmlFor="forms"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Generate Basic Forms
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    These files will be linked and prepared for Camunda import.
                  </p>
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
                <Button
                  onClick={handleStartExport}
                  disabled={type === "export" && !generateBpmn && !generateForms}
                >
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

          {isComplete && (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center py-6 space-y-3">
                <CheckCircle2 className="h-16 w-16 text-green-600" />
                <p className="text-lg font-semibold text-foreground">
                  {type === "export" ? "Export completed successfully!" : "Analysis completed successfully!"}
                </p>
                <p className="text-sm text-muted-foreground text-center">
                  Your {type === "export" ? "package" : "report"} is ready to download.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={handleClose}>
                  Close
                </Button>
                <Button onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  Download {type === "export" ? "Package (.zip)" : "Report (.pdf)"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
