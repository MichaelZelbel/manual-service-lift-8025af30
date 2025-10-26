// /src/actions/generateForCamunda.js
import { supabase } from '@/integrations/supabase/client';

/**
 * Generates enriched BPMN + forms for Manual Service and combines with subprocess BPMNs.
 * Calls backend function to upload everything to Supabase storage.
 */
export async function generateAndUploadBundle({
  serviceId,
  serviceName,
  bpmnModeler,
  templates,
}) {
  // 1. Generate enriched main BPMN + forms using formgen-core
  const { generateBundle } = await import('/lib/formgen-core.js');
  const { updatedBpmnXml, forms, manifest } = await generateBundle({
    serviceName,
    bpmnModeler,
    templates,
  });

  // 2. Fetch subprocess BPMNs from database
  const { data: subprocesses, error: subError } = await supabase
    .from('subprocesses')
    .select('*')
    .eq('service_id', serviceId);

  if (subError) throw new Error(`Failed to fetch subprocesses: ${subError.message}`);

  const subprocessBpmns = [];
  for (const subprocess of subprocesses || []) {
    const bpmnXml = subprocess.edited_bpmn_xml || subprocess.original_bpmn_xml;
    if (bpmnXml) {
      const base = sanitizeFilename(subprocess.name);
      const suffix = (subprocess.id || '').toString().slice(0, 8);
      const unique = suffix ? `${base}-${suffix}` : base;
      subprocessBpmns.push({ filename: `subprocess-${unique}.bpmn`, xml: bpmnXml });
    }
  }

  // 3. Build enhanced manifest
  const enhancedManifest = {
    serviceExternalId: serviceId,
    serviceName,
    generatedAt: new Date().toISOString(),
    bpmn: {
      main: { filename: 'manual-service.bpmn' },
      subprocesses: subprocessBpmns.map((sp, idx) => ({
        stepExternalId: `STEP-${String(idx + 1).padStart(2, '0')}`,
        filename: `subprocesses/${sp.filename}`,
        taskName: sp.filename.replace('subprocess-', '').replace('.bpmn', ''),
      })),
    },
    forms: manifest.forms,
  };

  // 4. Call backend function to handle uploads
  const { data, error } = await supabase.functions.invoke('upload-export', {
    body: {
      serviceId,
      serviceName,
      updatedBpmnXml,
      forms,
      subprocessBpmns,
      manifest: enhancedManifest,
    },
  });

  if (error) {
    console.error('Upload export error:', error);
    throw new Error(`Failed to upload export: ${error.message}`);
  }

  if (!data?.ok) {
    throw new Error(data?.error || 'Upload failed with unknown error');
  }

  return {
    exportFolder: data.exportFolder,
    manifest: enhancedManifest,
    formsCount: data.formsCount,
    subprocessCount: data.subprocessCount,
  };
}

function sanitizeFilename(name) {
  return name
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
}
