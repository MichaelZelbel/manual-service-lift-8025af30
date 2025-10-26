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
  // Import BpmnJS for parsing subprocess XMLs
  const BpmnJS = (await import('bpmn-js/lib/Modeler')).default;
  
  // 1. Generate enriched main BPMN + forms using formgen-core
  const { generateBundle } = await import('/lib/formgen-core.js');
  const { updatedBpmnXml, forms: mainForms, manifest: mainManifest } = await generateBundle({
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

  // 3. Process each subprocess to generate forms for its UserTasks
  const subprocessBpmns = [];
  const allForms = [...mainForms];
  
  for (const subprocess of subprocesses || []) {
    const bpmnXml = subprocess.edited_bpmn_xml || subprocess.original_bpmn_xml;
    if (!bpmnXml) continue;

    const filename = sanitizeFilename(subprocess.name);
    
    try {
      // Create a temporary modeler for this subprocess
      const subModeler = new BpmnJS();
      await subModeler.importXML(bpmnXml);
      
      // Generate forms for this subprocess
      const { updatedBpmnXml: subUpdatedXml, forms: subForms } = await generateBundle({
        serviceName: subprocess.name,
        bpmnModeler: subModeler,
        templates,
      });
      
      // Add subprocess forms to the collection
      allForms.push(...subForms);
      
      // Store updated subprocess BPMN (with form bindings)
      subprocessBpmns.push({
        id: subprocess.id,
        filename: `subprocess-${filename}.bpmn`,
        xml: subUpdatedXml,
        name: subprocess.name,
      });
      
      // Clean up
      subModeler.destroy();
    } catch (err) {
      console.error(`Failed to process subprocess ${subprocess.name}:`, err);
      // Fallback: use original XML without forms
      subprocessBpmns.push({
        id: subprocess.id,
        filename: `subprocess-${filename}.bpmn`,
        xml: bpmnXml,
        name: subprocess.name,
      });
    }
  }

  // 4. Build enhanced manifest
  const enhancedManifest = {
    serviceExternalId: serviceId,
    serviceName,
    generatedAt: new Date().toISOString(),
    bpmn: {
      main: { filename: 'manual-service.bpmn' },
      subprocesses: subprocessBpmns.map((sp, idx) => ({
        subprocessId: sp.id,
        stepExternalId: `STEP-${String(idx + 1).padStart(2, '0')}`,
        filename: `subprocesses/${sp.filename}`,
        taskName: sp.name,
        calledElement: sp.filename.replace('.bpmn', ''),
      })),
    },
    forms: allForms.map(({ nodeId, name, filename, formId }) => ({
      nodeId,
      name,
      filename: `forms/${filename}`,
      formId,
    })),
  };

  // 5. Create ZIP package
  const zip = new JSZip();
  
  // Add main BPMN (enriched)
  zip.file('manual-service.bpmn', updatedBpmnXml);
  
  // Add subprocess BPMNs (with form bindings)
  for (const { filename, xml } of subprocessBpmns) {
    zip.file(`subprocesses/${filename}`, xml);
  }
  
  // Add all forms (main + subprocess)
  for (const form of allForms) {
    zip.file(`forms/${form.filename}`, JSON.stringify(form.json, null, 2));
  }
  
  // Add manifest
  zip.file('manifest.json', JSON.stringify(enhancedManifest, null, 2));
  
  const zipBinary = await zip.generateAsync({ type: 'uint8array' });

  // 6. Upload to Supabase storage
  const exportFolder = `${serviceId}/${Date.now()}`;

  // Upload main BPMN
  await supabase.storage
    .from('exports')
    .upload(`${exportFolder}/manual-service.bpmn`, updatedBpmnXml, {
      contentType: 'application/xml',
      upsert: true,
    });

  // Upload subprocess BPMNs (with form bindings)
  for (const { filename, xml } of subprocessBpmns) {
    await supabase.storage
      .from('exports')
      .upload(`${exportFolder}/subprocesses/${filename}`, xml, {
        contentType: 'application/xml',
        upsert: true,
      });
  }

  // Upload all forms (main + subprocess)
  for (const form of allForms) {
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
    formsCount: allForms.length,
    subprocessCount: subprocessBpmns.length,
  };
}

function sanitizeFilename(name) {
  return name
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
}
