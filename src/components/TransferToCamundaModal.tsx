import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, ExternalLink, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface TransferToCamundaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceId: string;
  serviceName: string;
  bpmnModeler?: any;
  autoStart?: boolean;
}

interface TransferResult {
  success: boolean;
  projectId: string;
  projectName: string;
  projectUrl: string;
  filesUploaded: number;
  filesFailed: number;
  uploadDetails?: {
    successful: Array<{ name: string; fileId: string }>;
    failed: Array<{ name: string; error: string }>;
  };
  message: string;
}

const TRANSFER_STEPS = [
  { message: "Generating BPMN and forms...", duration: 1000 },
  { message: "Authenticating with Camunda...", duration: 800 },
  { message: "Creating project in Web Modeler...", duration: 700 },
  { message: "Uploading BPMN files...", duration: 1200 },
  { message: "Uploading forms...", duration: 900 },
  { message: "Finalizing transfer...", duration: 600 },
];

export function TransferToCamundaModal({
  open,
  onOpenChange,
  serviceId,
  serviceName,
  bpmnModeler,
  autoStart = false,
}: TransferToCamundaModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [transferResult, setTransferResult] = useState<TransferResult | null>(null);

  // Auto-start transfer when modal opens with autoStart=true
  useEffect(() => {
    if (open && autoStart && !isProcessing && !isComplete) {
      handleStartTransfer();
    }
  }, [open, autoStart]);

  const handleClose = () => {
    if (!isProcessing) {
      onOpenChange(false);
      setTimeout(() => {
        setIsComplete(false);
        setProgress(0);
        setCurrentStep("");
        setTransferResult(null);
      }, 200);
    }
  };

  const simulateProgress = async (steps: typeof TRANSFER_STEPS) => {
    const totalDuration = steps.reduce((sum, step) => sum + step.duration, 0);
    let elapsed = 0;

    for (const step of steps) {
      setCurrentStep(step.message);
      const startProgress = (elapsed / totalDuration) * 100;
      const endProgress = ((elapsed + step.duration) / totalDuration) * 100;

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

  const handleStartTransfer = async () => {
    setIsProcessing(true);
    setProgress(0);

    try {
      const progressPromise = simulateProgress(TRANSFER_STEPS);

      if (!bpmnModeler) {
        throw new Error("BPMN Modeler instance not available");
      }

      const { transferToCamunda } = await import("../actions/transferToCamunda.js");

      const result = await transferToCamunda({
        serviceId,
        serviceName,
        bpmnModeler,
      });

      await progressPromise;

      setTransferResult(result);
      setIsComplete(true);

      if (result.success) {
        toast.success(`Successfully transferred ${result.filesUploaded} files to Camunda!`);
      } else {
        toast.warning(
          `Transfer partially complete: ${result.filesUploaded} succeeded, ${result.filesFailed} failed`
        );
      }
      
      setIsProcessing(false);
    } catch (error) {
      console.error("Transfer error:", error);
      
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      if (errorMessage.includes("Authentication")) {
        toast.error("Failed to authenticate with Camunda. Please check API credentials.");
      } else if (errorMessage.includes("Rate limit")) {
        toast.error("Camunda API rate limit exceeded. Please try again in a minute.");
      } else if (errorMessage.includes("Network")) {
        toast.error("Network error. Please check your connection and try again.");
      } else {
        toast.error(errorMessage || "Failed to transfer to Camunda");
      }
      
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Transfer to Camunda Web Modeler</DialogTitle>
          <DialogDescription>
            Upload your BPMN process and forms to Camunda 8 Web Modeler
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {!isProcessing && !isComplete && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This will create a new project in Camunda Web Modeler containing:
              </p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>Main BPMN process diagram</li>
                <li>All subprocess BPMN files</li>
                <li>User task forms</li>
              </ul>
              <p className="text-sm text-muted-foreground">
                Project name: <strong>{serviceName}</strong>
              </p>
            </div>
          )}

          {isProcessing && !isComplete && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{currentStep}</span>
                  <span className="font-medium">{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            </div>
          )}

          {isComplete && transferResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">Transfer Complete</span>
              </div>

              <div className="bg-secondary p-4 rounded-lg space-y-2">
                <p className="text-sm">
                  <strong>Project Name:</strong> {transferResult.projectName}
                </p>
                <p className="text-sm">
                  <strong>Files Uploaded:</strong> {transferResult.filesUploaded}
                </p>
                {transferResult.filesFailed > 0 && (
                  <p className="text-sm text-destructive">
                    <strong>Files Failed:</strong> {transferResult.filesFailed}
                  </p>
                )}

                <Button
                  variant="outline"
                  className="w-full mt-2"
                  onClick={() => window.open(transferResult.projectUrl, '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View Project in Camunda
                </Button>
              </div>

              {transferResult.uploadDetails?.failed && transferResult.uploadDetails.failed.length > 0 && (
                <div className="bg-destructive/10 p-4 rounded-lg border border-destructive/20">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                    <div className="flex-1">
                      <p className="font-medium text-destructive text-sm mb-2">Failed Uploads:</p>
                      <ul className="text-sm space-y-1 text-destructive/90">
                        {transferResult.uploadDetails.failed.map((fail, idx) => (
                          <li key={idx} className="break-all">
                            <strong>{fail.name}:</strong> {fail.error}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          {!isProcessing && !isComplete && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleStartTransfer}>
                Start Transfer
              </Button>
            </>
          )}
          {isComplete && (
            <Button onClick={handleClose}>
              Close
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
