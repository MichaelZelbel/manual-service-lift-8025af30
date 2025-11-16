# Lovable AI Prompt: Add "Transfer to Camunda" Button

## Context

The Manual Service Lift application generates BPMN files and forms for Camunda 8. Currently, users can download these files via a "Download for Camunda" button. We need to add a new "Transfer to Camunda" button that automatically uploads the files to Camunda 8 Web Modeler via the Camunda API.

**Backend Implementation Status:** ✅ Complete
- Camunda API client library: `lib/camunda-client.js`
- Transfer edge function: `supabase/functions/transfer-to-camunda/index.ts`
- Frontend action: `src/actions/transferToCamunda.js`
- Environment variables configured in `.env`

## Task: Add "Transfer to Camunda" Button with Modal UI

### Requirements

1. **Add a new button** next to the existing "Download for Camunda" button
2. **Open a modal dialog** when clicked (similar to ExportModal)
3. **Show progress** with animated steps during transfer
4. **Display results** showing:
   - Success or failure status
   - Number of files uploaded
   - Link to the Camunda project
   - List of any failed uploads with error messages
5. **Handle errors gracefully** with user-friendly messages

---

## Implementation Instructions

### Step 1: Create TransferToCamundaModal Component

Create a new file: `src/components/TransferToCamundaModal.tsx`

This modal should:
- Take the same props as ExportModal: `open`, `onOpenChange`, `serviceId`, `serviceName`, `bpmnModeler`
- Show progress steps while transferring
- Display success/failure results
- Provide a link to view the project in Camunda Web Modeler

**Progress Steps to Display:**
```javascript
const TRANSFER_STEPS = [
  { message: "Generating BPMN and forms...", duration: 1000 },
  { message: "Authenticating with Camunda...", duration: 800 },
  { message: "Creating project in Web Modeler...", duration: 700 },
  { message: "Uploading BPMN files...", duration: 1200 },
  { message: "Uploading forms...", duration: 900 },
  { message: "Finalizing transfer...", duration: 600 },
];
```

**Main Transfer Function:**
```javascript
const handleStartTransfer = async () => {
  setIsProcessing(true);
  setProgress(0);

  try {
    // Simulate progress animation
    const progressPromise = simulateProgress(TRANSFER_STEPS);

    // Check if modeler is available
    if (!bpmnModeler) {
      throw new Error("BPMN Modeler instance not available");
    }

    // Call the transfer action
    const { transferToCamunda } = await import("../actions/transferToCamunda.js");

    const result = await transferToCamunda({
      serviceId,
      serviceName,
      bpmnModeler,
    });

    // Wait for progress animation to complete
    await progressPromise;

    // Store results
    setTransferResult(result);
    setIsComplete(true);

    if (result.success) {
      toast.success(`Successfully transferred ${result.filesUploaded} files to Camunda!`);
    } else {
      toast.warning(
        `Transfer partially complete: ${result.filesUploaded} succeeded, ${result.filesFailed} failed`
      );
    }
  } catch (error) {
    console.error("Transfer error:", error);
    toast.error(error.message || "Failed to transfer to Camunda");
    setIsProcessing(false);
  }
};
```

**Results Display:**
```jsx
{isComplete && transferResult && (
  <div className="space-y-4 mt-4">
    <div className="flex items-center gap-2 text-green-600">
      <CheckCircle2 className="h-5 w-5" />
      <span className="font-medium">Transfer Complete</span>
    </div>

    <div className="bg-secondary p-4 rounded-lg space-y-2">
      <p><strong>Project Name:</strong> {transferResult.projectName}</p>
      <p><strong>Files Uploaded:</strong> {transferResult.filesUploaded}</p>
      {transferResult.filesFailed > 0 && (
        <p className="text-destructive">
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

    {transferResult.uploadDetails?.failed?.length > 0 && (
      <div className="bg-destructive/10 p-4 rounded-lg">
        <p className="font-medium text-destructive mb-2">Failed Uploads:</p>
        <ul className="text-sm space-y-1">
          {transferResult.uploadDetails.failed.map((fail, idx) => (
            <li key={idx}>
              {fail.name}: {fail.error}
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
)}
```

### Step 2: Add Button to ProcessEditor Page

In `src/pages/ProcessEditor.tsx`, find the "Download for Camunda" button section (around line 236-239).

Add the new "Transfer to Camunda" button next to it:

```jsx
import { useState } from "react";
import { TransferToCamundaModal } from "@/components/TransferToCamundaModal";

// Inside the component, add state:
const [showTransferModal, setShowTransferModal] = useState(false);

// In the JSX, next to the Download button:
<Button
  variant="default"
  size="sm"
  onClick={() => setShowTransferModal(true)}
  className="gap-2"
>
  <Upload className="h-4 w-4" />
  Transfer to Camunda
</Button>

{/* Add the modal */}
<TransferToCamundaModal
  open={showTransferModal}
  onOpenChange={setShowTransferModal}
  serviceId={serviceId}
  serviceName={serviceName}
  bpmnModeler={bpmnModeler}
/>
```

**Import the Upload icon:**
```jsx
import { Upload } from "lucide-react";
```

### Step 3: Add Button to Dashboard Page

In `src/pages/Dashboard.tsx`, find the "Download for Camunda" button (around line 305-313).

Add similar functionality:

```jsx
import { TransferToCamundaModal } from "@/components/TransferToCamundaModal";

// Inside the component, add state:
const [showTransferModal, setShowTransferModal] = useState(false);
const [transferService, setTransferService] = useState(null);

// Create handler:
const handleTransferClick = async (service) => {
  // Initialize hidden modeler for this service
  const modeler = await getExportModeler(service.bpmn_xml);
  setTransferService({ ...service, modeler });
  setShowTransferModal(true);
};

// In the JSX, add button to the service card actions:
<Button
  variant="outline"
  size="sm"
  onClick={() => handleTransferClick(service)}
  className="gap-2"
>
  <Upload className="h-4 w-4" />
  Transfer to Camunda
</Button>

{/* Add the modal */}
{transferService && (
  <TransferToCamundaModal
    open={showTransferModal}
    onOpenChange={setShowTransferModal}
    serviceId={transferService.id}
    serviceName={transferService.name}
    bpmnModeler={transferService.modeler}
  />
)}
```

### Step 4: TypeScript Interfaces

Add this interface to `TransferToCamundaModal.tsx`:

```typescript
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
```

### Step 5: Styling Recommendations

**Button Styling:**
- Use `variant="default"` for primary action
- Use blue/primary color scheme to distinguish from the green Download button
- Add Upload icon from `lucide-react`

**Modal Styling:**
- Similar to ExportModal design
- Use Progress component for animated steps
- Use green CheckCircle2 for success
- Use red/destructive colors for errors
- Make the "View Project in Camunda" button prominent

### Step 6: Error Handling

Handle these specific errors:

```javascript
try {
  // ... transfer code ...
} catch (error) {
  console.error("Transfer error:", error);

  if (error.message.includes("Authentication")) {
    toast.error("Failed to authenticate with Camunda. Please check API credentials.");
  } else if (error.message.includes("Rate limit")) {
    toast.error("Camunda API rate limit exceeded. Please try again in a minute.");
  } else if (error.message.includes("Network")) {
    toast.error("Network error. Please check your connection and try again.");
  } else {
    toast.error(error.message || "Failed to transfer to Camunda");
  }

  setIsProcessing(false);
}
```

---

## Expected User Flow

1. User clicks "Transfer to Camunda" button
2. Modal opens showing "Start Transfer" button
3. User clicks "Start Transfer"
4. Progress bar animates through 6 steps (takes ~5 seconds)
5. Backend creates Camunda project and uploads files
6. Modal shows success message with:
   - Project name (e.g., "Handle Loan Application_2025-11-16T12-30-45")
   - Number of files uploaded
   - Button to open project in Camunda Web Modeler
7. User clicks "View Project in Camunda" → Opens new tab to Camunda
8. User sees all their BPMN and form files in the project

---

## Response Format Reference

Your transfer action will return this structure:

```typescript
// Success case:
{
  success: true,
  projectId: "abc123",
  projectName: "Handle Loan Application_2025-11-16T12-30-45",
  projectUrl: "https://modeler.camunda.io/projects/abc123",
  filesUploaded: 15,
  filesFailed: 0,
  message: "Successfully transferred 15 files to Camunda"
}

// Partial failure case:
{
  success: false,
  projectId: "abc123",
  projectName: "Handle Loan Application_2025-11-16T12-30-45",
  projectUrl: "https://modeler.camunda.io/projects/abc123",
  filesUploaded: 12,
  filesFailed: 3,
  uploadDetails: {
    successful: [...],
    failed: [
      { name: "forms/003-task.form", error: "API request failed: 429 Too Many Requests" }
    ]
  },
  message: "Transferred 12 files, 3 failed"
}
```

---

## Files to Create/Modify

**Create:**
- `src/components/TransferToCamundaModal.tsx`

**Modify:**
- `src/pages/ProcessEditor.tsx` - Add Transfer button and modal
- `src/pages/Dashboard.tsx` - Add Transfer button and modal

---

## Testing Checklist

After implementation, test:

- [ ] Button appears on ProcessEditor page
- [ ] Button appears on Dashboard page
- [ ] Modal opens when button clicked
- [ ] Progress animation works smoothly
- [ ] Transfer completes successfully
- [ ] Success message displays with project info
- [ ] "View Project in Camunda" link opens correct URL
- [ ] Error handling works for network failures
- [ ] Modal can be closed after completion
- [ ] Multiple transfers can be done in sequence

---

## Additional Notes

- The backend is fully implemented and ready to use
- The `transferToCamunda` action handles all the heavy lifting
- The edge function includes automatic retry logic for failed uploads
- Rate limiting is handled automatically (240 requests/minute)
- All BPMN and form files are uploaded; manifest.json is excluded automatically
- Project names are unique (include timestamp)
- No additional backend code is needed

---

## Example Mock Data for UI Testing

If you want to test the UI without calling the real backend:

```javascript
// Mock success result
const mockResult = {
  success: true,
  projectId: "mock-abc123",
  projectName: "Test Service_2025-11-16T12-30-45",
  projectUrl: "https://modeler.camunda.io/projects/mock-abc123",
  filesUploaded: 15,
  filesFailed: 0,
  uploadDetails: {
    successful: [
      { name: "manual-service.bpmn", fileId: "file1" },
      { name: "forms/000-start.form", fileId: "file2" },
      // ... more files
    ],
    failed: []
  },
  message: "Successfully transferred 15 files to Camunda"
};
```

---

## Support & Questions

If you need clarification on:
- The transfer action API: See `src/actions/transferToCamunda.js`
- Edge function implementation: See `supabase/functions/transfer-to-camunda/index.ts`
- Similar UI pattern: See `src/components/ExportModal.tsx`
- Testing guide: See `test-camunda-transfer.md`
