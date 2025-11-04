// /src/actions/generateForCamunda.js
import { supabase } from '@/integrations/supabase/client';
import { loadFormTemplates } from '@/utils/loadFormTemplates.js';
import { getExportModeler } from '@/utils/getExportModeler.js';
import { generateBundle } from '../../lib/formgen-core.js';
import { fetchStepDescription, fetchServiceDescription } from '@/integrations/supabase/descriptions';
import { fetchReferencesForService } from '@/integrations/mds/references';

/**
 * Generates enriched BPMN + forms for Manual Service and combines with subprocess BPMNs.
 * Uploads everything via the 'upload-export' edge function (server handles storage).
 *
 * Requirements:
 * - Either pass a live bpmnModeler (visible editor), OR pass manualServiceBpmnXml so we can create a headless one.
 */
export async function generateAndUploadBundle({
  serviceId,
  serviceName,
  bpmnModeler,            // optional if manualServiceBpmnXml provided
  manualServiceBpmnXml,   // optional if bpmnModeler provided
}) {
  // 0) Load form templates (signed URL flow, with fallback)
  const templates = await loadFormTemplates();

  // 1) Ensure we have a modeler (reuse visible one, else headless)
  const modeler = bpmnModeler
    ? bpmnModeler
    : await getExportModeler(assertString(manualServiceBpmnXml, 'manualServiceBpmnXml'));

  // 1.5) Fetch all references for this service
  const referencesMap = await fetchReferencesForService(String(serviceId));
  console.log('[generateForCamunda] References map:', referencesMap);

  // 2) Generate enriched main BPMN + forms
  const { updatedBpmnXml, forms, manifest } = await generateBundle({
    serviceName,
    bpmnModeler: modeler,
    templates,
    resolveDescriptions: async (node) => {
      try {
        const nodeId = node?.id || "";
        const nodeName = node?.businessObject?.name || "";
        const nodeType = node?.type || node?.businessObject?.$type || "";
        const isStartEvent = nodeType === 'bpmn:StartEvent';
        
        // Extract step_external_id from zeebe:calledElement if it's a CallActivity
        // OR for UserTask, query the manual_service_steps table by service_id + element_id
        let stepExternalId = null;
        if (nodeType === 'bpmn:CallActivity') {
          const extensionElements = node?.businessObject?.extensionElements;
          if (extensionElements?.values) {
            const calledElement = extensionElements.values.find((el) => 
              el.$type === 'zeebe:CalledElement'
            );
            if (calledElement?.processId) {
              // Extract from "Process_Sub_3365" -> "3365"
              const match = calledElement.processId.match(/Process_Sub_(.+)/);
              if (match) stepExternalId = match[1];
            }
          }
        } else if (nodeType === 'bpmn:UserTask') {
          // For UserTask, look up step_external_id from manual_service_steps table
          const { data: step, error: stepError } = await supabase
            .from('manual_service_steps')
            .select('step_external_id')
            .eq('service_id', serviceId)
            .eq('element_id', nodeId)
            .maybeSingle();
          
          if (!stepError && step?.step_external_id) {
            stepExternalId = step.step_external_id;
          }
        }
        
        // Look up references by step_external_id
        let refs = stepExternalId ? (referencesMap[stepExternalId] || []) : [];
        
        console.log(`[resolveDescriptions] Node ID: ${nodeId}, Name: ${nodeName}, IsStart: ${isStartEvent}, StepExtID: ${stepExternalId}, Found ${refs.length} references`);
        if (refs.length === 0 && stepExternalId) {
          console.log(`[resolveDescriptions] No refs found for stepExternalId ${stepExternalId}. Available keys:`, Object.keys(referencesMap));
        }
        
        // For StartEvents, fetch service-level description with robust fallbacks
        if (isStartEvent) {
          const serviceDesc = await fetchServiceDescription(String(serviceId));
          if (serviceDesc && serviceDesc.trim()) {
            return { stepDescription: serviceDesc.trim(), references: refs };
          }
          // Fallback 1: BPMN root process documentation
          try {
            const er = modeler.get?.("elementRegistry");
            const root = er?.getAll?.()?.find?.((e) => (e?.type === 'bpmn:Process' || e?.businessObject?.$type === 'bpmn:Process'));
            const docs = root?.businessObject?.documentation;
            if (Array.isArray(docs) && docs.length) {
              const text = docs.map((d) => (typeof d?.text === 'string' ? d.text : (d?.body || ''))).join('\n').trim();
              if (text) return { stepDescription: text, references: refs };
            }
          } catch (_) { /* ignore */ }
          // Fallback 2: StartEvent documentation
          try {
            const docs = node?.businessObject?.documentation;
            if (Array.isArray(docs) && docs.length) {
              const text = docs.map((d) => (typeof d?.text === 'string' ? d.text : (d?.body || ''))).join('\n').trim();
              if (text) return { stepDescription: text, references: refs };
            }
          } catch (_) { /* ignore */ }
        }
        
        // For other nodes, fetch step-specific description
        const fromDbById = await fetchStepDescription(String(serviceId), String(nodeId));
        if (fromDbById && fromDbById.trim()) return { stepDescription: fromDbById.trim(), references: refs };
        const docs = node?.businessObject?.documentation;
        if (Array.isArray(docs) && docs.length) {
          const text = docs
            .map((d) => (typeof d?.text === "string" ? d.text : (d?.body || "")))
            .join("\n")
            .trim();
          return { stepDescription: text, references: refs };
        }
        return { stepDescription: "", references: [] };
      } catch (err) {
        console.error('[resolveDescriptions] Error:', err);
        return { stepDescription: "", references: [] };
      }
    },
  });

  // 3) Fetch subprocess BPMNs from database (unchanged logic)
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

  // 4) Enhanced manifest (keeps your current shape)
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

  // 5) Upload via edge function (same as your current approach)
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
  return (name || '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
}

function assertString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required ${name}: expected non-empty string`);
  }
  return value;
}
