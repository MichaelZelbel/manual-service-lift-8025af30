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

  // 1.1) Fix process and element IDs to match MDS external IDs
  await fixBpmnIds(modeler, String(serviceId));

  // 1.5) Fetch all references for this service
  const referencesMap = await fetchReferencesForService(String(serviceId));
  console.log('[generateForCamunda] References map:', referencesMap);

  // Build service-wide fallback references (deduped by URL)
  const allServiceRefs = Array.from(
    new Map(
      Object.values(referencesMap)
        .flat()
        .map((r) => [r.url, r])
    ).values()
  );
  console.log('[generateForCamunda] Service-wide refs prepared:', allServiceRefs.length);

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
        
        console.log(`[resolveDescriptions] Processing node: id="${nodeId}", name="${nodeName}", type="${nodeType}", isStart=${isStartEvent}`);
        
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
          // For UserTask, match by step_name in mds_data to get step_external_id
          if (nodeName) {
            const { data: mdsStep, error: mdsError } = await supabase
              .from('mds_data')
              .select('step_external_id')
              .eq('service_external_id', serviceId)
              .eq('step_name', nodeName)
              .maybeSingle();
            
            if (!mdsError && mdsStep?.step_external_id) {
              stepExternalId = mdsStep.step_external_id;
              console.log(`[resolveDescriptions] Found step_external_id from mds_data by name match: ${stepExternalId}`);
            } else {
              console.log(`[resolveDescriptions] No mds_data match for step_name="${nodeName}"`);
            }
          }
        }
        
        // Look up references by step_external_id
         let refs = stepExternalId ? (referencesMap[stepExternalId] || []) : [];
         if (!refs.length) {
           refs = allServiceRefs;
           console.log(`[resolveDescriptions] No step-specific refs; using service-wide refs (${refs.length})`);
         } else {
           console.log(`[resolveDescriptions] StepExtID: ${stepExternalId}, Found ${refs.length} references`);
         }
        // For StartEvents, fetch service-level description with robust fallbacks
        if (isStartEvent) {
          console.log(`[resolveDescriptions] Start event detected, fetching service description for serviceId=${serviceId}`);
          const serviceDesc = await fetchServiceDescription(String(serviceId));
          console.log(`[resolveDescriptions] Service description from DB: "${serviceDesc}"`);
          
          if (serviceDesc && serviceDesc.trim()) {
            console.log(`[resolveDescriptions] ✓ Using service description from DB`);
            return { stepDescription: serviceDesc.trim(), references: refs };
          }
          
          // Fallback 1: BPMN root process documentation
          console.log(`[resolveDescriptions] No DB description, trying BPMN root process documentation...`);
          try {
            const er = modeler.get?.("elementRegistry");
            const root = er?.getAll?.()?.find?.((e) => (e?.type === 'bpmn:Process' || e?.businessObject?.$type === 'bpmn:Process'));
            const docs = root?.businessObject?.documentation;
            if (Array.isArray(docs) && docs.length) {
              const text = docs.map((d) => (typeof d?.text === 'string' ? d.text : (d?.body || ''))).join('\n').trim();
              if (text) {
                console.log(`[resolveDescriptions] ✓ Using BPMN root process documentation: "${text.substring(0, 50)}..."`);
                return { stepDescription: text, references: refs };
              }
            }
          } catch (e) {
            console.log(`[resolveDescriptions] Error reading root process docs:`, e);
          }
          
          // Fallback 2: StartEvent documentation
          console.log(`[resolveDescriptions] Trying StartEvent documentation...`);
          try {
            const docs = node?.businessObject?.documentation;
            if (Array.isArray(docs) && docs.length) {
              const text = docs.map((d) => (typeof d?.text === 'string' ? d.text : (d?.body || ''))).join('\n').trim();
              if (text) {
                console.log(`[resolveDescriptions] ✓ Using StartEvent documentation: "${text.substring(0, 50)}..."`);
                return { stepDescription: text, references: refs };
              }
            }
          } catch (e) {
            console.log(`[resolveDescriptions] Error reading StartEvent docs:`, e);
          }
          
          console.log(`[resolveDescriptions] ⚠ No description found for start event, returning empty`);
          return { stepDescription: "", references: refs };
        }
        
        // For other nodes, fetch step-specific description
        console.log(`[resolveDescriptions] Non-start node, fetching step description by element_id...`);
        const fromDbById = await fetchStepDescription(String(serviceId), String(nodeId));
        console.log(`[resolveDescriptions] Step description from DB: "${fromDbById}"`);
        
        if (fromDbById && fromDbById.trim()) {
          console.log(`[resolveDescriptions] ✓ Using step description from DB`);
          return { stepDescription: fromDbById.trim(), references: refs };
        }
        
        console.log(`[resolveDescriptions] Trying node documentation...`);
        const docs = node?.businessObject?.documentation;
        if (Array.isArray(docs) && docs.length) {
          const text = docs
            .map((d) => (typeof d?.text === "string" ? d.text : (d?.body || "")))
            .join("\n")
            .trim();
          if (text) {
            console.log(`[resolveDescriptions] ✓ Using node documentation: "${text.substring(0, 50)}..."`);
            return { stepDescription: text, references: refs };
          }
        }
        
        console.log(`[resolveDescriptions] ⚠ No description found, returning empty`);
        return { stepDescription: "", references: [] };
      } catch (err) {
        console.error('[resolveDescriptions] Error:', err);
        return { stepDescription: "", references: [] };
      }
    },
  });

  // 3) Fetch subprocess BPMNs from database and fix their IDs
  const { data: subprocesses, error: subError } = await supabase
    .from('subprocesses')
    .select('*')
    .eq('service_id', serviceId);

  if (subError) throw new Error(`Failed to fetch subprocesses: ${subError.message}`);

  const subprocessBpmns = [];
  for (const subprocess of subprocesses || []) {
    let bpmnXml = subprocess.edited_bpmn_xml || subprocess.original_bpmn_xml;
    if (bpmnXml) {
      // Fix subprocess process ID to use step_external_id instead of Process_Sub_XXX
      bpmnXml = await fixSubprocessId(bpmnXml, subprocess.name, serviceId);
      
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

/**
 * Fixes BPMN IDs to match MDS external IDs:
 * - Process ID: changes from "Process_Main_123" to "123"
 * - UserTask IDs: changes from "UserTask_First_1" to step_external_id
 */
async function fixBpmnIds(modeler, serviceId) {
  console.log('[fixBpmnIds] Starting ID fixes for service:', serviceId);
  
  const elementRegistry = modeler.get('elementRegistry');
  const modeling = modeler.get('modeling');
  const moddle = modeler.get('moddle');
  
  // Fix main process ID
  const allElements = elementRegistry.getAll();
  const processElement = allElements.find(
    (el) => el.type === 'bpmn:Process' || el.businessObject?.$type === 'bpmn:Process'
  );
  
  if (processElement) {
    const oldProcessId = processElement.id;
    console.log(`[fixBpmnIds] Current process ID: ${oldProcessId}`);
    
    // Only fix if it has the old format
    if (oldProcessId.includes('Process_Main_')) {
      console.log(`[fixBpmnIds] Changing process ID to: ${serviceId}`);
      modeling.updateProperties(processElement, { id: serviceId });
    }
  }
  
  // Fix UserTask IDs: match them to step_external_id from mds_data
  const userTasks = allElements.filter(
    (el) => el.type === 'bpmn:UserTask' || el.businessObject?.$type === 'bpmn:UserTask'
  );
  
  console.log(`[fixBpmnIds] Found ${userTasks.length} UserTasks to process`);
  
  for (const task of userTasks) {
    const taskName = task.businessObject?.name || '';
    const oldTaskId = task.id;
    
    console.log(`[fixBpmnIds] Processing task: id="${oldTaskId}", name="${taskName}"`);
    
    // Skip if already using numeric ID (likely already fixed)
    if (/^\d+$/.test(oldTaskId)) {
      console.log(`[fixBpmnIds] Task ${oldTaskId} already has numeric ID, skipping`);
      continue;
    }
    
    // Query mds_data to find step_external_id by matching step_name
    if (taskName) {
      const { data: mdsStep, error } = await supabase
        .from('mds_data')
        .select('step_external_id')
        .eq('service_external_id', serviceId)
        .eq('step_name', taskName)
        .maybeSingle();
      
      if (!error && mdsStep?.step_external_id) {
        console.log(`[fixBpmnIds] Changing task ID from "${oldTaskId}" to "${mdsStep.step_external_id}"`);
        modeling.updateProperties(task, { id: mdsStep.step_external_id });
      } else {
        console.log(`[fixBpmnIds] No mds_data match for task "${taskName}", keeping old ID`);
      }
    }
  }
  
  // Fix CallActivity references: update zeebe:calledElement processId
  const callActivities = allElements.filter(
    (el) => el.type === 'bpmn:CallActivity' || el.businessObject?.$type === 'bpmn:CallActivity'
  );
  
  console.log(`[fixBpmnIds] Found ${callActivities.length} CallActivities to process`);
  
  for (const callActivity of callActivities) {
    const extensionElements = callActivity.businessObject?.extensionElements;
    if (extensionElements?.values) {
      const calledElement = extensionElements.values.find((el) => 
        el.$type === 'zeebe:CalledElement'
      );
      
      if (calledElement?.processId) {
        const oldProcessId = calledElement.processId;
        console.log(`[fixBpmnIds] CallActivity has processId: ${oldProcessId}`);
        
        // If it's Process_Sub_XXX, extract XXX
        const match = oldProcessId.match(/^Process_Sub_(.+)$/);
        if (match) {
          const newProcessId = match[1];
          console.log(`[fixBpmnIds] Updating CallActivity processId to: ${newProcessId}`);
          calledElement.processId = newProcessId;
        }
      }
    }
  }
  
  console.log('[fixBpmnIds] ID fixes complete');
}

/**
 * Fixes subprocess process ID in BPMN XML string to use step_external_id
 */
async function fixSubprocessId(bpmnXml, subprocessName, serviceId) {
  console.log(`[fixSubprocessId] Fixing subprocess ID for: ${subprocessName}`);
  
  // Find step_external_id by matching subprocess name to step_name in mds_data
  const { data: mdsStep, error } = await supabase
    .from('mds_data')
    .select('step_external_id')
    .eq('service_external_id', serviceId)
    .eq('step_name', subprocessName)
    .maybeSingle();
  
  if (!error && mdsStep?.step_external_id) {
    const stepId = mdsStep.step_external_id;
    console.log(`[fixSubprocessId] Found step_external_id: ${stepId}, updating XML`);
    
    // Replace Process_Sub_XXX with just the step_external_id
    const updatedXml = bpmnXml.replace(
      /<bpmn:process id="Process_Sub_[^"]*"/g,
      `<bpmn:process id="${stepId}"`
    ).replace(
      /bpmnElement="Process_Sub_[^"]*"/g,
      `bpmnElement="${stepId}"`
    );
    
    return updatedXml;
  } else {
    console.log(`[fixSubprocessId] No mds_data match for subprocess "${subprocessName}", keeping original XML`);
    return bpmnXml;
  }
}
