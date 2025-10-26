// /src/actions/generateForCamunda.js
import JSZip from 'jszip';
import { supabase } from '@/integrations/supabase/client';

/**
 * Generates enriched BPMN + forms for Manual Service and combines with subprocess BPMNs.
 * Uploads everything to Supabase storage and returns the export folder path.
 */
export async function generateAndUploadBundle({
  serviceId,
  serviceName,
  bpmnModeler,
  templates,
}) {
  // 1. Generate enriched main BPMN + forms using formgen-core
  // Dynamic import to avoid parsing issues
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
      const filename = sanitizeFilename(subprocess.name);
      subprocessBpmns.push({
        filename: `subprocess-${filename}.bpmn`,
        xml: bpmnXml,
        stepExternalId: subprocess.step_external_id,
        name: subprocess.name
      });
    }
  }

  // 3. Build enhanced manifest
  const enhancedManifest = {
    serviceExternalId: serviceId,
    serviceName,
    generatedAt: new Date().toISOString(),
    bpmn: {
      main: { filename: 'manual-service.bpmn' },
      subprocesses: subprocessBpmns.map((sp) => ({
        stepExternalId: sp.stepExternalId || 'unknown',
        filename: `subprocesses/${sp.filename}`,
        taskName: sp.name,
        calledElement: sp.stepExternalId ? `Process_Sub_${sp.stepExternalId}` : undefined,
      })),
    },
    forms: manifest.forms,
  };

  // 4. Create ZIP package
  const zip = new JSZip();
  
  // Add main BPMN (enriched)
  zip.file('manual-service.bpmn', updatedBpmnXml);
  
  // Add subprocess BPMNs
  for (const { filename, xml } of subprocessBpmns) {
    zip.file(`subprocesses/${filename}`, xml);
  }
  
  // Add forms
  for (const form of forms) {
    zip.file(`forms/${form.filename}`, JSON.stringify(form.json, null, 2));
  }
  
  // Add manifest
  zip.file('manifest.json', JSON.stringify(enhancedManifest, null, 2));
  
  const zipBinary = await zip.generateAsync({ type: 'uint8array' });

  // 5. Upload to Supabase storage
  const exportFolder = `${serviceId}/${Date.now()}`;

  // Upload main BPMN
  await supabase.storage
    .from('exports')
    .upload(`${exportFolder}/manual-service.bpmn`, updatedBpmnXml, {
      contentType: 'application/xml',
      upsert: true,
    });

  // Upload subprocess BPMNs
  for (const { filename, xml } of subprocessBpmns) {
    await supabase.storage
      .from('exports')
      .upload(`${exportFolder}/subprocesses/${filename}`, xml, {
        contentType: 'application/xml',
        upsert: true,
      });
  }

  // Upload forms
  for (const form of forms) {
    await supabase.storage
      .from('exports')
      .upload(`${exportFolder}/forms/${form.filename}`, JSON.stringify(form.json, null, 2), {
        contentType: 'application/json',
        upsert: true,
      });
  }

  // Upload manifest
  await supabase.storage
    .from('exports')
    .upload(`${exportFolder}/manifest.json`, JSON.stringify(enhancedManifest, null, 2), {
      contentType: 'application/json',
      upsert: true,
    });

  // Upload ZIP package
  await supabase.storage
    .from('exports')
    .upload(`${exportFolder}/package.zip`, zipBinary, {
      contentType: 'application/zip',
      upsert: true,
    });

  // Update service timestamps
  await supabase
    .from('manual_services')
    .update({
      last_form_export: new Date().toISOString(),
      last_bpmn_export: new Date().toISOString(),
    })
    .eq('id', serviceId);

  return {
    exportFolder,
    manifest: enhancedManifest,
    formsCount: forms.length,
    subprocessCount: subprocessBpmns.length,
  };
}

function sanitizeFilename(name) {
  return name
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
}
