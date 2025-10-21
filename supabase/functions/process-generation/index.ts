import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FALLBACK_SUBPROCESS_TEMPLATE = (stepName: string, stepId: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Defs_Sub_${stepId}" targetNamespace="http://camunda.org/examples">
  <bpmn:process id="Process_Sub_${stepId}" name="${stepName}" isExecutable="true">
    <bpmn:startEvent id="StartEvent_${stepId}" name="Start"/>
    <bpmn:userTask id="UserTask_${stepId}" name="Process Activities"/>
    <bpmn:endEvent id="EndEvent_${stepId}" name="End"/>
    <bpmn:sequenceFlow id="Flow_1_${stepId}" sourceRef="StartEvent_${stepId}" targetRef="UserTask_${stepId}"/>
    <bpmn:sequenceFlow id="Flow_2_${stepId}" sourceRef="UserTask_${stepId}" targetRef="EndEvent_${stepId}"/>
  </bpmn:process>
</bpmn:definitions>`;

const FALLBACK_MAIN_TEMPLATE = (serviceName: string, serviceId: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="Defs_Main_${serviceId}" targetNamespace="http://camunda.org/examples">
  <bpmn:process id="Process_Main_${serviceId}" name="${serviceName}" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Start"/>
    <bpmn:userTask id="UserTask_1" name="Process Activities" camunda:candidateGroups="Default"/>
    <bpmn:endEvent id="EndEvent_1" name="End"/>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="UserTask_1"/>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="UserTask_1" targetRef="EndEvent_1"/>
  </bpmn:process>
</bpmn:definitions>`;

const SYSTEM_PROMPT = `You are a BPMN 2.0 generator for Camunda 8.
Return **only** well-formed BPMN 2.0 XML when asked. No markdown fences, no commentary.
IDs must be unique and concise (e.g., Task_1, Gateway_2).
bpmn:userTask for human work; bpmn:serviceTask for system work.
If a user task has a candidate_group, set camunda:candidateGroups="…".
When insufficient information exists, return the minimal fallback diagram.
Output must always be a single <bpmn:definitions>…</bpmn:definitions> document.`;

async function callClaude(prompt: string, apiKey: string, retryCount = 0): Promise<string> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 6000,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', errorText);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    if (retryCount < 1) {
      console.log('Retrying Claude API call...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      return callClaude(prompt, apiKey, retryCount + 1);
    }
    throw error;
  }
}

function extractXML(text: string): string {
  // Remove markdown code fences if present
  let xml = text.replace(/```(?:xml)?\s*/g, '').replace(/```/g, '').trim();
  
  // Validate it's XML
  if (!xml.includes('<bpmn:definitions')) {
    throw new Error('Response does not contain valid BPMN XML');
  }
  
  return xml;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { service_external_id } = await req.json();
    console.log('Starting process generation for service:', service_external_id);

    // Check if PDF fetch is complete (get most recent)
    const { data: pdfJobs } = await supabase
      .from('jobs')
      .select('*')
      .eq('service_external_id', service_external_id)
      .eq('job_type', 'pdf_fetch')
      .order('created_at', { ascending: false })
      .limit(1);

    const pdfJob = pdfJobs?.[0];
    
    if (!pdfJob || pdfJob.status !== 'completed') {
      return new Response(
        JSON.stringify({ error: 'PDF fetch must complete first' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update job status to running
    await supabase
      .from('jobs')
      .update({ 
        status: 'running',
        started_at: new Date().toISOString()
      })
      .eq('service_external_id', service_external_id)
      .eq('job_type', 'process_generation');

    // Fetch MDS data
    const { data: mdsData, error: mdsError } = await supabase
      .from('mds_data')
      .select('*')
      .eq('service_external_id', service_external_id)
      .order('step_external_id');

    if (mdsError || !mdsData || mdsData.length === 0) {
      throw new Error('No MDS data found for this service');
    }

    console.log(`Found ${mdsData.length} MDS rows`);

    // Fetch service info
    const { data: serviceData, error: serviceError } = await supabase
      .from('manual_services')
      .select('*')
      .eq('id', service_external_id)
      .single();

    if (serviceError || !serviceData) {
      throw new Error(`Service not found: ${serviceError?.message}`);
    }

    // Fetch PDF documents
    const { data: documents } = await supabase
      .from('documents')
      .select('*')
      .eq('service_external_id', service_external_id)
      .eq('status', 'completed');

    console.log(`Found ${documents?.length || 0} documents`);

    // Build steps with their PDF information
    const stepsInfo = mdsData.map((row: any) => {
      const sopUrls = row.sop_urls?.split(',').map((u: string) => u.trim()).filter(Boolean) || [];
      const decisionUrls = row.decision_sheet_urls?.split(',').map((u: string) => u.trim()).filter(Boolean) || [];
      const allUrls = [...sopUrls, ...decisionUrls];
      
      const stepDocs = documents?.filter((doc: any) => 
        allUrls.some(url => doc.source_url === url)
      ) || [];

      const sop_texts = stepDocs.map((doc: any) => 
        `Document: ${doc.source_url}\nStatus: ${doc.status}`
      );

      return {
        step_external_id: row.step_external_id,
        name: row.step_name,
        type: row.type || 'regular',
        candidate_group: row.candidate_group,
        sop_texts,
        pdf_urls: allUrls
      };
    });

    console.log('Generating subprocess BPMNs...');
    const subprocesses = [];

    // Generate one subprocess BPMN per step
    for (const step of stepsInfo) {
      console.log(`Generating subprocess for step: ${step.name}`);
      
      const pdfInfo = step.pdf_urls.length > 0 
        ? `\nPDF Documents for this step:\n${step.pdf_urls.join('\n')}`
        : '\nNo detailed documentation available.';
      
      const subprocessPrompt = `Create a BPMN subprocess for the following step. Extract 3-9 major actions.

Step Name: ${step.name}
Step ID: ${step.step_external_id}
Type: ${step.type}
Candidate Group: ${step.candidate_group || 'None'}
${pdfInfo}

Instructions:
- Default to bpmn:userTask unless the text clearly implies automation (then bpmn:serviceTask)
- If candidate_group is present, add camunda:candidateGroups="${step.candidate_group || ''}" to all user tasks
- Use process id="Process_Sub_${step.step_external_id}" name="${step.name}"
- Create 3-9 logical tasks based on typical steps for this type of activity
- Return only BPMN XML, no other text`;

      try {
        const xmlResponse = await callClaude(subprocessPrompt, ANTHROPIC_API_KEY);
        const subprocess_bpmn_xml = extractXML(xmlResponse);
        
        subprocesses.push({
          step_external_id: step.step_external_id,
          subprocess_name: step.name,
          subprocess_bpmn_xml
        });
        
        console.log(`✓ Generated subprocess for ${step.name}`);
      } catch (error) {
        console.error(`Failed to generate subprocess for ${step.name}, using fallback:`, error);
        subprocesses.push({
          step_external_id: step.step_external_id,
          subprocess_name: step.name,
          subprocess_bpmn_xml: FALLBACK_SUBPROCESS_TEMPLATE(step.name, step.step_external_id)
        });
      }
    }

    console.log('Generating main process BPMN...');
    
    // Generate main process with callActivities
    const mainPrompt = `Create a main BPMN process that orchestrates the following steps using callActivities.

Service Name: ${serviceData.name}
Service ID: ${service_external_id}
Performing Team: ${serviceData.performing_team}
Performer Org: ${serviceData.performer_org}

Steps (in order):
${stepsInfo.map((step: any, idx: number) => `${idx + 1}. ${step.name} (${step.type}${step.candidate_group ? ', group: ' + step.candidate_group : ''})`).join('\n')}

Instructions:
- Use process id="Process_Main_${service_external_id}" name="${serviceData.name}"
- For each step, create a bpmn:callActivity with calledElement="Process_Sub_{{step_external_id}}"
- Order steps logically; insert gateways if branching is implied by names
- Map types: regular/fixed/unknown → bpmn:userTask, data collection → bpmn:serviceTask
- For user tasks in main process, if candidate_group exists, set camunda:candidateGroups
- If no branching is clear, connect sequentially
- Return only BPMN XML, no other text`;

    let main_bpmn_xml: string;
    try {
      const mainXmlResponse = await callClaude(mainPrompt, ANTHROPIC_API_KEY);
      main_bpmn_xml = extractXML(mainXmlResponse);
      console.log('✓ Generated main process');
    } catch (error) {
      console.error('Failed to generate main process, using fallback:', error);
      main_bpmn_xml = FALLBACK_MAIN_TEMPLATE(serviceData.name, service_external_id);
    }

    console.log('Persisting to database...');

    // Update manual_services with main BPMN
    await supabase
      .from('manual_services')
      .update({
        original_bpmn_xml: main_bpmn_xml,
        last_analysis: new Date().toISOString(),
      })
      .eq('id', service_external_id);

    // Create subprocesses and manual_service_steps
    for (let i = 0; i < mdsData.length; i++) {
      const row = mdsData[i];
      const subprocessData = subprocesses.find((sp: any) => sp.step_external_id === row.step_external_id);

      if (!subprocessData) {
        console.error(`No subprocess found for step ${row.step_external_id}`);
        continue;
      }

      // Create subprocess
      const { data: subprocess, error: subprocessError } = await supabase
        .from('subprocesses')
        .insert({
          service_id: service_external_id,
          name: row.step_name,
          original_bpmn_xml: subprocessData.subprocess_bpmn_xml,
        })
        .select()
        .single();

      if (subprocessError || !subprocess) {
        console.error('Failed to create subprocess:', subprocessError);
        continue;
      }

      // Create manual_service_step
      await supabase
        .from('manual_service_steps')
        .insert({
          service_id: service_external_id,
          subprocess_id: subprocess.id,
          name: row.step_name,
          description: row.step_name,
          step_order: i,
          original_order: i,
          candidate_group: row.candidate_group,
        });

      console.log(`✓ Created subprocess and step for: ${row.step_name}`);
    }

    // Mark job as complete
    await supabase
      .from('jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('service_external_id', service_external_id)
      .eq('job_type', 'process_generation');

    console.log('Process generation complete!');

    return new Response(
      JSON.stringify({ 
        ok: true,
        main_bpmn_generated: true,
        subprocesses_generated: subprocesses.length
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Process generation error:', error);
    
    // Mark job as failed
    try {
      const body = await req.json();
      const { service_external_id } = body;
      
      if (service_external_id) {
        await supabase
          .from('jobs')
          .update({
            status: 'failed',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            completed_at: new Date().toISOString(),
          })
          .eq('service_external_id', service_external_id)
          .eq('job_type', 'process_generation');
      }
    } catch (e) {
      console.error('Failed to update job status:', e);
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
