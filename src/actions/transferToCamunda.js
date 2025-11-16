// /src/actions/transferToCamunda.js
import { supabase } from '@/integrations/supabase/client';
import { loadFormTemplates } from '@/utils/loadFormTemplates.js';
import { getExportModeler } from '@/utils/getExportModeler.js';
import { generateBundle } from '../../lib/formgen-core.js';
import { fetchStepDescription, fetchServiceDescription } from '@/integrations/supabase/descriptions';
import { fetchReferencesForService } from '@/integrations/mds/references';

/**
 * Helper to ensure a value is a string
 */
function assertString(val, name) {
  if (typeof val !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  return val;
}

/**
 * Fix BPMN IDs to match MDS external IDs
 */
async function fixBpmnIds(modeler, serviceId) {
  const { data: service } = await supabase
    .from('manual_services')
    .select('external_id')
    .eq('id', serviceId)
    .single();

  if (!service?.external_id) {
    console.warn('[fixBpmnIds] No external_id found for service');
    return;
  }

  const modeling = modeler.get('modeling');
  const elementRegistry = modeler.get('elementRegistry');

  // Fix process ID
  const process = elementRegistry.find(el => el.type === 'bpmn:Process');
  if (process) {
    modeling.updateProperties(process, {
      id: `Manual_Service_ID_${service.external_id}`
    });
  }

  // Fix UserTask and CallActivity IDs
  const { data: mdsData } = await supabase
    .from('mds_data')
    .select('step_name, step_external_id')
    .eq('service_external_id', serviceId);

  const stepNameToExtId = {};
  for (const row of mdsData || []) {
    if (row.step_name && row.step_external_id) {
      stepNameToExtId[row.step_name] = row.step_external_id;
    }
  }

  elementRegistry.forEach(element => {
    const name = element.businessObject?.name;
    if (!name) return;

    const extId = stepNameToExtId[name];
    if (!extId) return;

    if (element.type === 'bpmn:UserTask' || element.type === 'bpmn:CallActivity') {
      modeling.updateProperties(element, {
        id: `Process_Step_ID_${extId}`
      });
    }
  });
}

/**
 * Transfer BPMN and forms to Camunda 8 Web Modeler
 *
 * This function:
 * 1. Generates enriched BPMN + forms (same as download workflow)
 * 2. Fetches subprocess BPMNs
 * 3. Calls the transfer-to-camunda edge function
 * 4. Returns transfer results with Camunda project URL
 *
 * @param {Object} params
 * @param {string} params.serviceId - Manual service ID
 * @param {string} params.serviceName - Manual service name
 * @param {Object} params.bpmnModeler - Optional: Live BPMN modeler instance
 * @param {string} params.manualServiceBpmnXml - Optional: BPMN XML string
 * @returns {Promise<Object>} Transfer result with success status and project info
 */
export async function transferToCamunda({
  serviceId,
  serviceName,
  bpmnModeler,
  manualServiceBpmnXml,
}) {
  try {
    console.log('[transferToCamunda] Starting transfer process...');
    console.log('[transferToCamunda] Service:', serviceName, '(ID:', serviceId, ')');

    // 0) Load form templates
    const templates = await loadFormTemplates();

    // 1) Ensure we have a modeler (reuse visible one, else headless)
    const modeler = bpmnModeler
      ? bpmnModeler
      : await getExportModeler(assertString(manualServiceBpmnXml, 'manualServiceBpmnXml'));

    // 1.1) Fix process and element IDs to match MDS external IDs
    await fixBpmnIds(modeler, String(serviceId));

    // 1.5) Fetch all references for this service
    const referencesMap = await fetchReferencesForService(String(serviceId));
    console.log('[transferToCamunda] References map:', referencesMap);

    // Build service-wide fallback references (deduped by URL)
    const allServiceRefs = Array.from(
      new Map(
        Object.values(referencesMap)
          .flat()
          .map((r) => [r.url, r])
      ).values()
    );
    console.log('[transferToCamunda] Service-wide refs prepared:', allServiceRefs.length);

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

          console.log(`[resolveDescriptions] Processing node: id="${nodeId}", name="${nodeName}", type="${nodeType}"`);

          let stepExternalId = null;
          if (nodeType === 'bpmn:CallActivity') {
            const extensionElements = node?.businessObject?.extensionElements;
            if (extensionElements?.values) {
              const calledElement = extensionElements.values.find((el) =>
                el.$type === 'zeebe:CalledElement'
              );
              if (calledElement?.processId) {
                const match = calledElement.processId.match(/Process_Sub_(.+)/);
                if (match) stepExternalId = match[1];
              }
            }
          } else if (nodeType === 'bpmn:UserTask') {
            if (nodeName) {
              const { data: mdsStep } = await supabase
                .from('mds_data')
                .select('step_external_id')
                .eq('service_external_id', serviceId)
                .eq('step_name', nodeName)
                .maybeSingle();

              if (mdsStep?.step_external_id) {
                stepExternalId = mdsStep.step_external_id;
              }
            }
          }

          let refs = stepExternalId ? (referencesMap[stepExternalId] || []) : [];
          if (!refs.length) {
            refs = allServiceRefs;
          }

          let stepDescription = '';
          let serviceDescription = '';

          if (isStartEvent) {
            serviceDescription = await fetchServiceDescription(String(serviceId));
          } else if (stepExternalId) {
            stepDescription = await fetchStepDescription(String(serviceId), stepExternalId);
          }

          return {
            stepDescription: stepDescription || '',
            serviceDescription: serviceDescription || '',
            references: refs || [],
          };
        } catch (err) {
          console.error('[resolveDescriptions] Error:', err);
          return { stepDescription: '', serviceDescription: '', references: [] };
        }
      }
    });

    console.log('[transferToCamunda] Generated forms:', forms?.length);
    console.log('[transferToCamunda] Generated manifest');

    // 3) Fetch subprocess BPMNs from DB
    const { data: subprocesses, error: subError } = await supabase
      .from('subprocesses')
      .select('*')
      .eq('service_id', serviceId);

    if (subError) {
      console.error('[transferToCamunda] Error fetching subprocesses:', subError);
      throw new Error(`Failed to fetch subprocesses: ${subError.message}`);
    }

    console.log('[transferToCamunda] Fetched subprocesses:', subprocesses?.length || 0);

    // 3.1) Fix subprocess IDs and prepare BPMN XML
    const subprocessBpmns = [];
    for (const sub of subprocesses || []) {
      // Use edited_bpmn_xml if available, otherwise use original_bpmn_xml
      let xml = sub.edited_bpmn_xml || sub.original_bpmn_xml;

      if (!xml) {
        console.warn(`[transferToCamunda] Subprocess ${sub.id} has no BPMN XML, skipping`);
        continue;
      }

      // Create proper filename based on subprocess name and id
      const sanitizedName = sub.name.replace(/[^a-zA-Z0-9-]/g, '-');
      const filename = `subprocess-${sanitizedName}-${sub.id.substring(0, 8)}.bpmn`;

      // Extract step_external_id - try to get it from MDS data
      const { data: mdsMatch } = await supabase
        .from('mds_data')
        .select('step_external_id')
        .eq('service_external_id', serviceId)
        .eq('step_name', sub.name)
        .single();

      const stepExternalId = mdsMatch?.step_external_id;

      if (stepExternalId && xml) {
        // Fix subprocess process ID to match step external ID
        xml = xml.replace(
          /id="Process_[^"]+"/,
          `id="Process_Sub_${stepExternalId}"`
        );
      }

      subprocessBpmns.push({
        filename,
        xml,
      });
    }

    // 4) Call the transfer-to-camunda edge function
    console.log('[transferToCamunda] Calling transfer-to-camunda edge function...');

    const { data: transferResult, error: transferError } = await supabase.functions.invoke(
      'transfer-to-camunda',
      {
        body: {
          serviceId: String(serviceId),
          serviceName: String(serviceName),
          updatedBpmnXml,
          forms,
          subprocessBpmns,
          manifest, // Included but will be ignored by edge function
        },
      }
    );

    if (transferError) {
      console.error('[transferToCamunda] Transfer error:', transferError);
      throw new Error(`Transfer to Camunda failed: ${transferError.message}`);
    }

    console.log('[transferToCamunda] Transfer result:', transferResult);

    return {
      success: transferResult.success,
      projectId: transferResult.projectId,
      projectName: transferResult.projectName,
      projectUrl: transferResult.projectUrl,
      filesUploaded: transferResult.filesUploaded,
      filesFailed: transferResult.filesFailed,
      uploadDetails: transferResult.uploadDetails,
      message: transferResult.message,
    };
  } catch (error) {
    console.error('[transferToCamunda] Error:', error);
    throw error;
  }
}
