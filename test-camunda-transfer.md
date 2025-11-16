# Camunda Transfer Testing Guide

## What Was Implemented

### 1. **Camunda API Client Library** (`lib/camunda-client.js`)
- OAuth2 authentication with Camunda Console API
- Token caching and automatic refresh
- Methods for creating projects and uploading files
- Built-in retry logic and rate limiting (240 req/min)

### 2. **Transfer Edge Function** (`supabase/functions/transfer-to-camunda/index.ts`)
- Server-side function that handles the transfer to Camunda
- Creates a project with name: `{serviceName}_{timestamp}`
- Uploads all BPMN and form files (excludes manifest.json)
- Returns detailed transfer results with project URL

### 3. **Frontend Action** (`src/actions/transferToCamunda.js`)
- Reuses the same file generation logic as the download workflow
- Calls the transfer edge function
- Returns success/failure status and Camunda project information

### 4. **Environment Configuration** (`.env`)
- Added Camunda Console API credentials
- Configured OAuth endpoints and API URLs

### 5. **Database Migration** (`supabase/migrations/20251116000000_add_camunda_transfer_timestamp.sql`)
- Added `last_camunda_transfer` column to track transfer history

## Files Transferred to Camunda

The following files are uploaded to Camunda Web Modeler:
- ✅ `manual-service.bpmn` - Main process BPMN
- ✅ `subprocesses/*.bpmn` - All subprocess BPMNs
- ✅ `forms/*.form` - All Camunda form JSON files
- ❌ `manifest.json` - **EXCLUDED** (metadata only, not needed in Camunda)

## How to Test

### Option 1: Manual Test via Frontend (Requires Lovable AI Implementation)

Once the frontend button is implemented (see Lovable AI prompt below), you can test by:

1. Open a Manual Service in the Process Editor
2. Click "Transfer to Camunda" button
3. Wait for the transfer to complete
4. You should see:
   - Success/failure message
   - Number of files uploaded
   - Link to the Camunda project
   - Any errors for failed files

### Option 2: Test Edge Function Directly

You can test the edge function using curl:

```bash
# First, get your Supabase anon key from .env
SUPABASE_URL="https://nqzreyydyirslxdtfuna.supabase.co"
SUPABASE_ANON_KEY="your-anon-key-here"

# Example request body (you'll need actual BPMN XML and form data)
curl -X POST "${SUPABASE_URL}/functions/v1/transfer-to-camunda" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "your-service-id",
    "serviceName": "Test Service",
    "updatedBpmnXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>...",
    "forms": [],
    "subprocessBpmns": []
  }'
```

### Option 3: Test from Browser Console

1. Open the application in your browser
2. Navigate to a Manual Service
3. Open browser DevTools console
4. Run:

```javascript
import { transferToCamunda } from '@/actions/transferToCamunda';

// Get the BPMN modeler instance from the page
const modeler = window.bpmnModeler; // or however it's exposed

// Call transfer
const result = await transferToCamunda({
  serviceId: 'your-service-id',
  serviceName: 'Test Service',
  bpmnModeler: modeler
});

console.log('Transfer result:', result);
console.log('View project at:', result.projectUrl);
```

## Expected Response Format

### Success Response
```json
{
  "success": true,
  "projectId": "abc123",
  "projectName": "Handle Loan Application_2025-11-16T12-30-45",
  "projectUrl": "https://modeler.camunda.io/projects/abc123",
  "filesUploaded": 15,
  "filesFailed": 0,
  "uploadDetails": {
    "successful": [
      { "name": "manual-service.bpmn", "fileId": "file123" },
      { "name": "forms/000-start.form", "fileId": "file124" }
    ],
    "failed": []
  },
  "message": "Successfully transferred 15 files to Camunda"
}
```

### Partial Success Response (HTTP 207)
```json
{
  "success": false,
  "projectId": "abc123",
  "projectName": "Handle Loan Application_2025-11-16T12-30-45",
  "projectUrl": "https://modeler.camunda.io/projects/abc123",
  "filesUploaded": 12,
  "filesFailed": 3,
  "uploadDetails": {
    "successful": [...],
    "failed": [
      { "name": "forms/003-task.form", "error": "API request failed: 429 Too Many Requests" }
    ]
  },
  "message": "Transferred 12 files, 3 failed"
}
```

### Error Response (HTTP 500)
```json
{
  "success": false,
  "error": "Authentication failed: 401 Unauthorized",
  "details": "Error: Authentication failed..."
}
```

## Deployment Checklist

Before this will work in production:

- [ ] Deploy the edge function: `npx supabase functions deploy transfer-to-camunda`
- [ ] Apply database migration: `npx supabase db push` or via Supabase Dashboard
- [ ] Set environment variables in Supabase Dashboard:
  - `CAMUNDA_CONSOLE_CLIENT_ID`
  - `CAMUNDA_CONSOLE_CLIENT_SECRET`
  - `CAMUNDA_OAUTH_URL`
  - `CAMUNDA_CONSOLE_BASE_URL`
  - `CAMUNDA_CONSOLE_OAUTH_AUDIENCE`
  - `CAMUNDA_MODELER_API_URL`
- [ ] Implement frontend button (see Lovable AI prompt)
- [ ] Test with a real service

## Troubleshooting

### "Authentication failed"
- Check that Camunda credentials are correctly set in environment variables
- Verify the client ID and secret are valid
- Check the OAuth URL is accessible

### "Rate limit exceeded" (HTTP 429)
- The function includes automatic retry with exponential backoff
- If many files are being uploaded, this is expected and will auto-retry
- Maximum 240 requests per minute to Camunda API

### "Failed to upload file"
- Check the error details in the response
- Verify the file content is valid (BPMN XML or form JSON)
- Check Camunda API status

### "Project created but no files uploaded"
- Check the console logs in Supabase Functions dashboard
- Verify the files array is not empty
- Check for CORS issues

## Next Steps

1. Deploy the edge function to Supabase
2. Implement the frontend button using the Lovable AI prompt below
3. Test with a real manual service
4. Monitor the first few transfers in Supabase Functions logs
5. Check the created projects in Camunda Web Modeler UI
