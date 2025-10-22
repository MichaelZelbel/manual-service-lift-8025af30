import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';
import JSZip from 'https://esm.sh/jszip@3.10.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FormInfo {
  nodeId: string;
  name: string;
  filename: string;
  formId: string;
  templateType: string;
}

interface ManifestData {
  service: string;
  generatedAt: string;
  forms: FormInfo[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Generate forms request received');
    
    const { serviceId, generateBpmn, generateForms } = await req.json();
    
    if (!serviceId) {
      return new Response(
        JSON.stringify({ error: 'Missing serviceId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch service data
    const { data: service, error: serviceError } = await supabase
      .from('manual_services')
      .select('*')
      .eq('id', serviceId)
      .single();

    if (serviceError || !service) {
      throw new Error('Service not found');
    }

    // Get BPMN XML (prefer edited, fallback to original)
    const bpmnXml = service.edited_bpmn_xml || service.original_bpmn_xml;
    if (!bpmnXml) {
      throw new Error('No BPMN data found for service');
    }

    // Fetch MDS data for reference documents
    const { data: mdsData } = await supabase
      .from('mds_data')
      .select('*')
      .eq('service_external_id', serviceId)
      .order('process_step');

    // Fetch manual service steps for subprocess info
    const { data: serviceSteps } = await supabase
      .from('manual_service_steps')
      .select('*, subprocess_id')
      .eq('service_id', serviceId)
      .order('step_order');

    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', 'T');
    const manifest: ManifestData = {
      service: service.name,
      generatedAt: new Date().toISOString(),
      forms: [],
    };

    // Parse BPMN
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(bpmnXml, 'text/xml');
    if (!xmlDoc) {
      throw new Error('Failed to parse BPMN XML');
    }

    const forms: Record<string, string> = {};
    let updatedBpmnXml = bpmnXml;

    if (generateForms) {
      // Load form templates
      const templates = await loadFormTemplates(supabase);
      
      // Get ordered elements from BPMN
      const orderedElements = getOrderedBpmnElements(xmlDoc);
      
      // Generate forms and update BPMN
      let formIndex = 0;
      for (const element of orderedElements) {
        const elementId = element.getAttribute('id') || '';
        const elementName = element.getAttribute('name') || elementId;
        const elementType = element.tagName;

        let templateType: string | null = null;
        let formFilename: string;
        let formId: string;

        // Determine if this is start event or user task
        if (elementType === 'bpmn:startEvent') {
          // Start event - always use First Step template
          const templateKey = determineStartTemplate(element, xmlDoc);
          templateType = templateKey;
          formFilename = '000-start.form';
          formId = `000-start-${timestamp}`;
        } else if (elementType === 'bpmn:userTask') {
          // User task - use Next Step template
          const templateKey = determineUserTaskTemplate(element, xmlDoc);
          templateType = templateKey;
          const paddedIndex = String(formIndex + 1).padStart(3, '0');
          const slug = sanitizeFilename(elementName);
          formFilename = `${paddedIndex}-${slug}.form`;
          formId = `${paddedIndex}-${slug}-${timestamp}`;
          formIndex++;
        } else {
          continue; // Skip non-form elements
        }

        if (templateType && templates[templateType]) {
          // Generate form
          const formJson = await generateFormJson(
            templates[templateType],
            {
              serviceName: service.name,
              stepName: elementName,
              stepDescription: getStepDescription(elementId, serviceSteps),
              nextTasks: getNextTasks(element, xmlDoc),
              references: getReferences(elementId, mdsData),
              formId,
            }
          );

          forms[formFilename] = formJson;
          manifest.forms.push({
            nodeId: elementId,
            name: elementName,
            filename: formFilename,
            formId,
            templateType,
          });

          // Update BPMN with form definition
          updatedBpmnXml = addFormDefinitionToBpmn(updatedBpmnXml, elementId, formId, elementType);
        }
      }
    }

    // Save updated BPMN
    if (generateBpmn && updatedBpmnXml !== bpmnXml) {
      await supabase
        .from('manual_services')
        .update({ edited_bpmn_xml: updatedBpmnXml })
        .eq('id', serviceId);
    }

    // Create ZIP package
    const zipBlob = await createZipPackage(
      updatedBpmnXml,
      forms,
      manifest,
      service.name,
      generateBpmn
    );

    // Upload ZIP to storage
    const zipFilename = `exports/${serviceId}/${Date.now()}/package.zip`;
    const { error: uploadError } = await supabase.storage
      .from('form_templates')
      .upload(zipFilename, zipBlob, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw new Error('Failed to upload package');
    }

    // Generate signed URL
    const { data: urlData } = await supabase.storage
      .from('form_templates')
      .createSignedUrl(zipFilename, 3600);

    // Update service timestamps
    await supabase
      .from('manual_services')
      .update({
        last_form_export: new Date().toISOString(),
        last_bpmn_export: generateBpmn ? new Date().toISOString() : service.last_bpmn_export,
      })
      .eq('id', serviceId);

    return new Response(
      JSON.stringify({
        ok: true,
        downloadUrl: urlData?.signedUrl,
        formsGenerated: manifest.forms.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Generate forms error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function loadFormTemplates(supabase: any): Promise<Record<string, any>> {
  const templates: Record<string, any> = {};
  const templateFiles = [
    { key: 'FIRST_STEP_SINGLE', file: 'first-step-single-path.form' },
    { key: 'FIRST_STEP_MULTI', file: 'first-step-multi-path.form' },
    { key: 'NEXT_STEP_SINGLE', file: 'next-step-single-path.form' },
    { key: 'NEXT_STEP_MULTI', file: 'next-step-multi-path.form' },
  ];

  for (const { key, file } of templateFiles) {
    const { data } = await supabase.storage.from('form_templates').download(file);
    if (data) {
      const text = await data.text();
      templates[key] = JSON.parse(text);
    }
  }

  return templates;
}

function getOrderedBpmnElements(xmlDoc: any): any[] {
  const elements: any[] = [];
  
  // Get all flow elements
  const startEvents = xmlDoc.querySelectorAll('bpmn\\:startEvent, startEvent');
  const userTasks = xmlDoc.querySelectorAll('bpmn\\:userTask, userTask');
  
  // Add start events first
  for (const el of startEvents) {
    elements.push(el);
  }
  
  // Add user tasks
  for (const el of userTasks) {
    elements.push(el);
  }
  
  return elements;
}

function determineStartTemplate(startEvent: any, xmlDoc: any): string {
  const outgoing = startEvent.querySelectorAll('bpmn\\:outgoing, outgoing');
  
  if (outgoing.length === 1) {
    // Check if next element is parallel gateway
    const flowId = outgoing[0].textContent?.trim();
    const flow = xmlDoc.querySelector(`[id="${flowId}"]`);
    if (flow) {
      const targetRef = flow.getAttribute('targetRef');
      const target = xmlDoc.querySelector(`[id="${targetRef}"]`);
      if (target && target.tagName.includes('parallelGateway')) {
        return 'FIRST_STEP_SINGLE';
      }
    }
    return 'FIRST_STEP_SINGLE';
  }
  
  return 'FIRST_STEP_MULTI';
}

function determineUserTaskTemplate(userTask: any, xmlDoc: any): string {
  const outgoing = userTask.querySelectorAll('bpmn\\:outgoing, outgoing');
  
  if (outgoing.length === 1) {
    return 'NEXT_STEP_SINGLE';
  }
  
  return 'NEXT_STEP_MULTI';
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
}

function getStepDescription(elementId: string, serviceSteps: any[] | null): string {
  if (!serviceSteps) return '';
  const step = serviceSteps.find(s => s.name.includes(elementId) || elementId.includes(s.name));
  return step?.description || '';
}

function getNextTasks(element: any, xmlDoc: any): string[] {
  const tasks: string[] = [];
  const outgoing = element.querySelectorAll('bpmn\\:outgoing, outgoing');
  
  for (const out of outgoing) {
    const flowId = out.textContent?.trim();
    const flow = xmlDoc.querySelector(`[id="${flowId}"]`);
    if (flow) {
      const targetRef = flow.getAttribute('targetRef');
      const target = xmlDoc.querySelector(`[id="${targetRef}"]`);
      if (target) {
        const name = target.getAttribute('name') || targetRef;
        tasks.push(name);
      }
    }
  }
  
  return tasks;
}

function getReferences(elementId: string, mdsData: any[] | null): string {
  if (!mdsData) return '';
  const step = mdsData.find(s => s.step_external_id === elementId);
  const refs: string[] = [];
  if (step?.sop_urls) refs.push(step.sop_urls);
  if (step?.decision_sheet_urls) refs.push(step.decision_sheet_urls);
  return refs.join(', ');
}

async function generateFormJson(
  template: any,
  replacements: {
    serviceName: string;
    stepName: string;
    stepDescription: string;
    nextTasks: string[];
    references: string;
    formId: string;
  }
): Promise<string> {
  let formJson = JSON.stringify(template, null, 2);
  
  // Replace placeholders
  formJson = formJson.replace(/ManualServiceNamePlaceholder/g, replacements.serviceName);
  formJson = formJson.replace(/ProcessStepPlaceholder/g, replacements.stepName);
  formJson = formJson.replace(/ProcessDescriptionPlaceholder/g, replacements.stepDescription);
  formJson = formJson.replace(/NextTaskPlaceholder/g, replacements.nextTasks.join(', '));
  formJson = formJson.replace(/ReferencesPlaceholder/g, replacements.references);
  
  const form = JSON.parse(formJson);
  form.id = replacements.formId;
  
  return JSON.stringify(form, null, 2);
}

function addFormDefinitionToBpmn(
  bpmnXml: string,
  elementId: string,
  formId: string,
  elementType: string
): string {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(bpmnXml, 'text/xml');
  
  if (!xmlDoc) return bpmnXml;
  
  const element = xmlDoc.querySelector(`[id="${elementId}"]`);
  if (!element) return bpmnXml;
  
  // Get or create extensionElements
  let extensionElements = element.querySelector('bpmn\\:extensionElements, extensionElements');
  if (!extensionElements) {
    extensionElements = xmlDoc.createElement('bpmn:extensionElements');
    element.insertBefore(extensionElements, element.firstChild);
  }
  
  // Remove existing formDefinition if any
  const existingFormDef = extensionElements.querySelector('zeebe\\:formDefinition, formDefinition');
  if (existingFormDef) {
    existingFormDef.remove();
  }
  
  // Add new formDefinition
  const formDef = xmlDoc.createElement('zeebe:formDefinition');
  formDef.setAttribute('formId', formId);
  formDef.setAttribute('bindingType', 'deployment');
  extensionElements.appendChild(formDef);
  
  // For user tasks, ensure zeebe:userTask exists
  if (elementType === 'bpmn:userTask') {
    const existingUserTask = extensionElements.querySelector('zeebe\\:userTask, userTask');
    if (!existingUserTask) {
      const userTask = xmlDoc.createElement('zeebe:userTask');
      extensionElements.appendChild(userTask);
    }
  }
  
  return xmlDoc.documentElement?.outerHTML || bpmnXml;
}

async function createZipPackage(
  bpmnXml: string,
  forms: Record<string, string>,
  manifest: ManifestData,
  serviceName: string,
  includeBpmn: boolean
): Promise<Uint8Array> {
  const zip = new JSZip();
  
  if (includeBpmn) {
    zip.file('manual-service.bpmn', bpmnXml);
  }
  
  for (const [filename, content] of Object.entries(forms)) {
    zip.file(filename, content);
  }
  
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  
  const zipBlob = await zip.generateAsync({ type: 'uint8array' });
  return zipBlob;
}
