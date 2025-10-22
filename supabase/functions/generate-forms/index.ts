import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
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

    // Fetch subprocesses
    const { data: subprocesses } = await supabase
      .from('subprocesses')
      .select('*')
      .eq('service_id', serviceId);

    console.log('Fetched subprocesses:', subprocesses?.length || 0);

    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', 'T');
    const manifest: ManifestData = {
      service: service.name,
      generatedAt: new Date().toISOString(),
      forms: [],
    };

    const forms: Record<string, string> = {};
    const bpmnFiles: Record<string, string> = {};
    let updatedBpmnXml = bpmnXml;

    // Add main BPMN to files
    if (generateBpmn) {
      bpmnFiles['manual-service.bpmn'] = bpmnXml;
      
      // Add subprocess BPMNs
      if (subprocesses && subprocesses.length > 0) {
        for (const subprocess of subprocesses) {
          const subBpmn = subprocess.edited_bpmn_xml || subprocess.original_bpmn_xml;
          if (subBpmn) {
            const filename = `subprocess-${sanitizeFilename(subprocess.name)}.bpmn`;
            bpmnFiles[filename] = subBpmn;
            console.log('Added subprocess BPMN:', filename);
          }
        }
      }
    }

    if (generateForms) {
      // Load form templates
      const templates = await loadFormTemplates(supabase);
      
      // Get ordered elements from main BPMN using regex
      const orderedElements = getOrderedBpmnElements(bpmnXml);
      
      // Generate form for start event
      let formIndex = 0;
      for (const element of orderedElements) {
        const elementId = element.id;
        const elementName = element.name || elementId;
        const elementTag = element.type;

        if (elementTag === 'startEvent') {
          // Start event - use First Step template
          const templateKey = 'FIRST_STEP_SINGLE'; // Simplified for now
          const formFilename = '000-start.form';
          const formId = `000-start-${timestamp}`;

          const tpl = templates[templateKey];
          const formJson = await (tpl
            ? generateFormJson(tpl, {
                serviceName: service.name,
                stepName: elementName,
                stepDescription: 'Initial process step',
                nextTasks: [],
                references: '',
                formId,
              })
            : generateFallbackFormJson({
                kind: 'start',
                serviceName: service.name,
                stepName: elementName,
                stepDescription: 'Initial process step',
                nextTasks: [],
                references: '',
                formId,
              }));

          forms[formFilename] = formJson;
          manifest.forms.push({
            nodeId: elementId,
            name: elementName,
            filename: formFilename,
            formId,
            templateType: templateKey,
          });

          // Update BPMN with form definition
          updatedBpmnXml = addFormDefinitionToBpmn(updatedBpmnXml, elementId, formId, elementTag);
          console.log('Generated form for start event');
        } else if (elementTag === 'userTask') {
          // User task - generate form and link it
          formIndex++;
          const templateKey = 'NEXT_STEP_SINGLE'; // Simplified for now
          const slug = sanitizeFilename(elementName);
          const paddedIndex = String(formIndex).padStart(3, '0');
          const formFilename = `${paddedIndex}-${slug}.form`;
          const formId = `${paddedIndex}-${slug}-${timestamp}`;

          const tpl = templates[templateKey];
          const formJson = await (tpl
            ? generateFormJson(tpl, {
                serviceName: service.name,
                stepName: elementName,
                stepDescription: getStepDescription(elementId, serviceSteps) || '',
                nextTasks: [],
                references: getReferences(elementId, mdsData),
                formId,
              })
            : generateFallbackFormJson({
                kind: 'userTask',
                serviceName: service.name,
                stepName: elementName,
                stepDescription: getStepDescription(elementId, serviceSteps) || '',
                nextTasks: [],
                references: getReferences(elementId, mdsData),
                formId,
              }));

          forms[formFilename] = formJson;
          manifest.forms.push({
            nodeId: elementId,
            name: elementName,
            filename: formFilename,
            formId,
            templateType: templateKey,
          });

          // Update BPMN with form definition on the user task
          updatedBpmnXml = addFormDefinitionToBpmn(updatedBpmnXml, elementId, formId, elementTag);
          console.log('Generated form for user task:', elementName);
        }
      }

      // Generate forms for each subprocess
      if (subprocesses && subprocesses.length > 0) {
        for (let i = 0; i < subprocesses.length; i++) {
          const subprocess = subprocesses[i];
          const paddedIndex = String(i + 1).padStart(3, '0');
          const slug = sanitizeFilename(subprocess.name);
          const formFilename = `${paddedIndex}-${slug}.form`;
          const formId = `${paddedIndex}-${slug}-${timestamp}`;

          // Determine template based on subprocess structure
          const templateKey = 'NEXT_STEP_SINGLE'; // Default to single path for subprocesses

          // Get step description and references
          const step = serviceSteps?.find(s => s.subprocess_id === subprocess.id);
          const mdsStep = mdsData?.find(m => m.step_external_id === subprocess.id);

          const tpl = templates[templateKey];
          const formJson = await (tpl
            ? generateFormJson(tpl, {
                serviceName: service.name,
                stepName: subprocess.name,
                stepDescription: step?.description || '',
                nextTasks: [],
                references: mdsStep ? getReferencesFromMds(mdsStep) : '',
                formId,
              })
            : generateFallbackFormJson({
                kind: 'subprocess',
                serviceName: service.name,
                stepName: subprocess.name,
                stepDescription: step?.description || '',
                nextTasks: [],
                references: mdsStep ? getReferencesFromMds(mdsStep) : '',
                formId,
              }));

          forms[formFilename] = formJson;
          manifest.forms.push({
            nodeId: subprocess.id,
            name: subprocess.name,
            filename: formFilename,
            formId,
            templateType: templateKey,
          });
          console.log('Generated form for subprocess:', subprocess.name);
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

    // Ensure main BPMN in ZIP is the updated one (with form links)
    if (generateBpmn) {
      bpmnFiles['manual-service.bpmn'] = updatedBpmnXml;
    }

    // Create folder structure for this export
    const exportFolder = `${serviceId}/${Date.now()}`;
    
    // Create enhanced manifest with BPMN subprocess info
    const enhancedManifest = {
      serviceExternalId: serviceId,
      serviceName: service.name,
      generatedAt: manifest.generatedAt,
      bpmn: {
        main: { filename: 'manual-service.bpmn' },
        subprocesses: (subprocesses || []).map((sp, idx) => ({
          stepExternalId: `STEP-${String(idx + 1).padStart(2, '0')}`,
          subprocessId: sp.id,
          calledElement: `Process_Sub_${sp.id.substring(0, 8)}`,
          filename: `subprocesses/subprocess-${sanitizeFilename(sp.name)}.bpmn`,
          taskName: sp.name
        }))
      },
      forms: manifest.forms
    };

    // Upload all individual files
    // 1. Main BPMN
    if (generateBpmn) {
      await supabase.storage
        .from('exports')
        .upload(
          `${exportFolder}/manual-service.bpmn`,
          bpmnFiles['manual-service.bpmn'],
          { contentType: 'application/xml', upsert: true }
        );
      
      // 2. Subprocess BPMNs
      for (const [filename, content] of Object.entries(bpmnFiles)) {
        if (filename !== 'manual-service.bpmn') {
          await supabase.storage
            .from('exports')
            .upload(
              `${exportFolder}/subprocesses/${filename}`,
              content,
              { contentType: 'application/xml', upsert: true }
            );
        }
      }
    }

    // 3. Forms
    for (const [filename, content] of Object.entries(forms)) {
      await supabase.storage
        .from('exports')
        .upload(
          `${exportFolder}/forms/${filename}`,
          content,
          { contentType: 'application/json', upsert: true }
        );
    }

    // 4. Manifest
    await supabase.storage
      .from('exports')
      .upload(
        `${exportFolder}/manifest.json`,
        JSON.stringify(enhancedManifest, null, 2),
        { contentType: 'application/json', upsert: true }
      );

    // 5. Also create ZIP package for easy download
    const zipBlob = await createZipPackage(
      bpmnFiles,
      forms,
      enhancedManifest,
      service.name,
      generateBpmn
    );

    const zipFilename = `${exportFolder}/package.zip`;
    const { error: uploadError } = await supabase.storage
      .from('exports')
      .upload(zipFilename, zipBlob, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw new Error('Failed to upload package');
    }

    // Generate signed URL for ZIP
    const { data: urlData } = await supabase.storage
      .from('exports')
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

function getOrderedBpmnElements(bpmnXml: string): Array<{id: string, name: string, type: string}> {
  const elements: Array<{id: string, name: string, type: string}> = [];
  
  // Find start events
  const startEventPattern = /<(?:bpmn:)?startEvent[^>]*\sid="([^"]+)"[^>]*(?:\sname="([^"]*)")?[^>]*>/gi;
  let match;
  while ((match = startEventPattern.exec(bpmnXml)) !== null) {
    elements.push({
      id: match[1],
      name: match[2] || match[1],
      type: 'startEvent'
    });
  }
  
  // Find user tasks
  const userTaskPattern = /<(?:bpmn:)?userTask[^>]*\sid="([^"]+)"[^>]*(?:\sname="([^"]*)")?[^>]*>/gi;
  while ((match = userTaskPattern.exec(bpmnXml)) !== null) {
    elements.push({
      id: match[1],
      name: match[2] || match[1],
      type: 'userTask'
    });
  }
  
  return elements;
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

function getReferencesFromMds(mdsStep: any): string {
  const refs: string[] = [];
  if (mdsStep.sop_urls) refs.push(mdsStep.sop_urls);
  if (mdsStep.decision_sheet_urls) refs.push(mdsStep.decision_sheet_urls);
  return refs.join(', ');
}

function getReferences(elementId: string, mdsData: any[] | null): string {
  if (!mdsData) return '';
  const step = mdsData.find(s => s.step_external_id === elementId);
  return step ? getReferencesFromMds(step) : '';
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

// Fallback basic form generator used when templates are unavailable
function generateFallbackFormJson(params: {
  kind: 'start' | 'subprocess' | string;
  serviceName: string;
  stepName: string;
  stepDescription: string;
  nextTasks: string[];
  references: string;
  formId: string;
}): string {
  const form = {
    id: params.formId,
    type: 'form',
    title: `${params.serviceName} - ${params.stepName}`,
    description: params.stepDescription || (params.kind === 'start' ? 'Initial process step' : 'Process step'),
    fields: [
      { type: 'section', label: 'Task Details' },
      { type: 'text', label: 'Service', value: params.serviceName },
      { type: 'text', label: 'Step', value: params.stepName },
      { type: 'textarea', label: 'Description', value: params.stepDescription || '' },
      { type: 'text', label: 'Next tasks', value: (params.nextTasks || []).join(', ') },
      { type: 'text', label: 'References', value: params.references || '' },
      { type: 'separator' },
      { type: 'textarea', label: 'Notes', value: '' }
    ]
  } as any;

  return JSON.stringify(form, null, 2);
}

function addFormDefinitionToBpmn(
  bpmnXml: string,
  elementId: string,
  formId: string,
  elementType: string
): string {
  // Use string manipulation instead of DOM parsing to preserve XML case sensitivity
  const formDefinition = `<zeebe:formDefinition formId="${formId}" bindingType="deployment" />`;
  
  // Find the element by ID using regex
  const elementPattern = new RegExp(
    `(<(?:bpmn:)?(?:startEvent|userTask)[^>]*\\sid="${elementId}"[^>]*>)([\\s\\S]*?)(<\\/(?:bpmn:)?(?:startEvent|userTask)>)`,
    'i'
  );
  
  const match = bpmnXml.match(elementPattern);
  if (!match) return bpmnXml;
  
  const [fullMatch, openingTag, content, closingTag] = match;
  
  // Check if extensionElements already exists
  const extensionPattern = /<(bpmn:)?extensionElements>([\s\S]*?)<\/(bpmn:)?extensionElements>/i;
  const extensionMatch = content.match(extensionPattern);
  
  let newContent: string;
  if (extensionMatch) {
    // extensionElements exists - remove any existing formDefinition and add new one
    let extensionContent = extensionMatch[2];
    
    // Remove existing formDefinition
    extensionContent = extensionContent.replace(
      /<(zeebe:)?formDefinition[^>]*\/>/gi,
      ''
    );
    
    // Add new formDefinition at the beginning
    const updatedExtension = `<bpmn:extensionElements>\n      ${formDefinition}${extensionContent}\n    </bpmn:extensionElements>`;
    newContent = content.replace(extensionPattern, updatedExtension);
  } else {
    // No extensionElements - create one with formDefinition
    const newExtension = `\n    <bpmn:extensionElements>\n      ${formDefinition}\n    </bpmn:extensionElements>`;
    newContent = newExtension + content;
  }
  
  return bpmnXml.replace(fullMatch, openingTag + newContent + closingTag);
}

async function createZipPackage(
  bpmnFiles: Record<string, string>,
  forms: Record<string, string>,
  manifest: any,
  serviceName: string,
  includeBpmn: boolean
): Promise<Uint8Array> {
  const zip = new JSZip();
  
  // Add main BPMN
  if (includeBpmn && bpmnFiles['manual-service.bpmn']) {
    zip.file('manual-service.bpmn', bpmnFiles['manual-service.bpmn']);
    console.log('Added to ZIP: manual-service.bpmn');
  }
  
  // Add subprocess BPMNs in subprocesses folder
  if (includeBpmn) {
    for (const [filename, content] of Object.entries(bpmnFiles)) {
      if (filename !== 'manual-service.bpmn') {
        zip.file(`subprocesses/${filename}`, content);
        console.log('Added to ZIP:', `subprocesses/${filename}`);
      }
    }
  }
  
  // Add form files in forms folder
  for (const [filename, content] of Object.entries(forms)) {
    zip.file(`forms/${filename}`, content);
    console.log('Added to ZIP:', `forms/${filename}`);
  }
  
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  
  const zipBlob = await zip.generateAsync({ type: 'uint8array' });
  return zipBlob;
}
