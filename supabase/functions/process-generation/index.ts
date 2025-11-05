import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FALLBACK_SUBPROCESS_TEMPLATE = (stepName: string, stepId: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
  xmlns:modeler="http://camunda.org/schema/modeler/1.0"
  id="Defs_Sub_${stepId}" targetNamespace="http://camunda.org/examples">
  <bpmn:process id="${stepId}" name="${stepName}" isExecutable="true">
    <bpmn:startEvent id="StartEvent_${stepId}" name="Start">
      <bpmn:outgoing>Flow_1_${stepId}</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="UserTask_${stepId}" name="Process Activities">
      <bpmn:incoming>Flow_1_${stepId}</bpmn:incoming>
      <bpmn:outgoing>Flow_2_${stepId}</bpmn:outgoing>
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="user-task" />
      </bpmn:extensionElements>
    </bpmn:userTask>
    <bpmn:endEvent id="EndEvent_${stepId}" name="End">
      <bpmn:incoming>Flow_2_${stepId}</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1_${stepId}" sourceRef="StartEvent_${stepId}" targetRef="UserTask_${stepId}"/>
    <bpmn:sequenceFlow id="Flow_2_${stepId}" sourceRef="UserTask_${stepId}" targetRef="EndEvent_${stepId}"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_${stepId}">
    <bpmndi:BPMNPlane id="BPMNPlane_${stepId}" bpmnElement="${stepId}">
      <bpmndi:BPMNShape id="Shape_Start_${stepId}" bpmnElement="StartEvent_${stepId}">
        <dc:Bounds x="152" y="102" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_Task_${stepId}" bpmnElement="UserTask_${stepId}">
        <dc:Bounds x="210" y="80" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_End_${stepId}" bpmnElement="EndEvent_${stepId}">
        <dc:Bounds x="330" y="102" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Edge_Flow1_${stepId}" bpmnElement="Flow_1_${stepId}">
        <di:waypoint x="188" y="120"/>
        <di:waypoint x="210" y="120"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Edge_Flow2_${stepId}" bpmnElement="Flow_2_${stepId}">
        <di:waypoint x="310" y="120"/>
        <di:waypoint x="330" y="120"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const FALLBACK_MAIN_TEMPLATE = (serviceName: string, serviceId: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
  xmlns:modeler="http://camunda.org/schema/modeler/1.0"
  id="Defs_Main_${serviceId}" targetNamespace="http://camunda.org/examples">
  <bpmn:process id="${serviceId}" name="${serviceName}" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Start">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="UserTask_1" name="Process Activities">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
      <bpmn:extensionElements>
        <zeebe:taskDefinition type="user-task" />
        <zeebe:taskHeaders>
          <zeebe:header key="candidateGroups" value="Default" />
        </zeebe:taskHeaders>
      </bpmn:extensionElements>
    </bpmn:userTask>
    <bpmn:endEvent id="EndEvent_1" name="End">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="UserTask_1"/>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="UserTask_1" targetRef="EndEvent_1"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_${serviceId}">
    <bpmndi:BPMNPlane id="BPMNPlane_${serviceId}" bpmnElement="${serviceId}">
      <bpmndi:BPMNShape id="Shape_Start_${serviceId}" bpmnElement="StartEvent_1">
        <dc:Bounds x="152" y="102" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_Task_${serviceId}" bpmnElement="UserTask_1">
        <dc:Bounds x="210" y="80" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_End_${serviceId}" bpmnElement="EndEvent_1">
        <dc:Bounds x="330" y="102" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Edge_Flow1_${serviceId}" bpmnElement="Flow_1">
        <di:waypoint x="188" y="120"/>
        <di:waypoint x="210" y="120"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Edge_Flow2_${serviceId}" bpmnElement="Flow_2">
        <di:waypoint x="310" y="120"/>
        <di:waypoint x="330" y="120"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const SYSTEM_PROMPT = `You are a BPMN 2.0 generator for Camunda 8.
Return **only** well-formed BPMN 2.0 XML when asked. No markdown fences, no commentary.

CRITICAL REQUIREMENTS:
1. Use Camunda 8 namespaces:
   - xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
   - xmlns:modeler="http://camunda.org/schema/modeler/1.0"
   - Do NOT use xmlns:camunda (that's Camunda 7)

2. ALWAYS include complete <bpmndi:BPMNDiagram> section with:
   - <bpmndi:BPMNPlane> containing the process
   - <bpmndi:BPMNShape> for EVERY task, gateway, and event
   - <bpmndi:BPMNEdge> for EVERY sequence flow
   - Proper dc:Bounds with x, y, width, height coordinates
   - Layout elements horizontally with ~150-200px spacing

3. Element specifications:
   - IDs must be unique and concise (e.g., Task_1, Gateway_2, Flow_1)
   - Use bpmn:userTask for human work
   - Use bpmn:serviceTask for system/automated work
   - Set isExecutable="true" on process

4. For Camunda 8 task assignment, use zeebe:taskDefinition instead of camunda:candidateGroups:
   <bpmn:userTask id="Task_1" name="Task Name">
     <bpmn:extensionElements>
       <zeebe:taskDefinition type="user-task" />
       <zeebe:taskHeaders>
         <zeebe:header key="candidateGroups" value="GROUP_NAME" />
       </zeebe:taskHeaders>
     </bpmn:extensionElements>
   </bpmn:userTask>

5. Standard namespace declaration:
   xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
   xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
   xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
   xmlns:modeler="http://camunda.org/schema/modeler/1.0"

6. When insufficient information exists, return a minimal but complete diagram with all required sections.

Output must be a complete, valid BPMN 2.0 XML document that can be imported directly into Camunda 8.`;

async function callClaude(prompt: string, apiKey: string, retryCount = 0): Promise<string> {
  const REQUEST_TIMEOUT_MS = 45000; // 45 second timeout per request
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('Claude API error:', errorText);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    if (retryCount < 1) {
      const reason = (error instanceof Error && error.name === 'AbortError') ? 'timeout' : 'error';
      console.log(`Retrying Claude API call due to ${reason}...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return callClaude(prompt, apiKey, retryCount + 1);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
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

/**
 * Validate that generated XML is complete and well-formed
 */
function isCompleteXML(xml: string): boolean {
  const trimmed = xml.trim();
  
  // Check for proper closing of root element
  if (!trimmed.endsWith('</bpmn:definitions>')) {
    console.error('XML validation failed: missing closing </bpmn:definitions>');
    return false;
  }
  
  // Basic tag balance check
  const openTags = (trimmed.match(/<[^/][^>]*[^/]>/g) || []).length;
  const closeTags = (trimmed.match(/<\/[^>]+>/g) || []).length;
  const selfClosing = (trimmed.match(/<[^>]+\/>/g) || []).length;
  
  const isBalanced = (openTags - selfClosing) === closeTags;
  if (!isBalanced) {
    console.error(`XML validation failed: tag mismatch (open: ${openTags}, self-closing: ${selfClosing}, close: ${closeTags})`);
  }
  
  return isBalanced;
}

/**
 * Generate a fallback main BPMN with CallActivities for all steps
 */
/**
 * Generate a fallback main BPMN with UserTasks for all steps
 */
function generateFallbackMainBPMN(serviceName: string, serviceId: string, steps: any[]): string {
  // Identify first steps (process_step === 1)
  const firstSteps = steps.filter((step: any) => step.process_step === 1);
  const hasMultipleFirstSteps = firstSteps.length > 1;
  const otherSteps = steps.filter((step: any) => step.process_step !== 1);
  
  let currentX = 210;
  const elements: Array<{xml: string, shape: string, id: string, xPos: number, incoming: string[], outgoing: string[]}> = [];
  const flows: Array<{xml: string, edge: string}> = [];
  
  // If multiple first steps, create inclusive gateway
  if (hasMultipleFirstSteps) {
    // Add inclusive gateway split
    elements.push({
      xml: `  <bpmn:inclusiveGateway id="Gateway_Split" name="Split"/>`,
      shape: `    <bpmndi:BPMNShape id="Shape_Gateway_Split" bpmnElement="Gateway_Split">
      <dc:Bounds x="${currentX}" y="95" width="50" height="50"/>
    </bpmndi:BPMNShape>`,
      id: 'Gateway_Split',
      xPos: currentX,
      incoming: ['Flow_Start_Gateway'],
      outgoing: firstSteps.map((_, idx) => `Flow_Gateway_UserTask_First_${idx + 1}`)
    });
    
    // Flow from start to gateway
    flows.push({
      xml: `  <bpmn:sequenceFlow id="Flow_Start_Gateway" sourceRef="StartEvent_1" targetRef="Gateway_Split"/>`,
      edge: `    <bpmndi:BPMNEdge id="Edge_Start_Gateway" bpmnElement="Flow_Start_Gateway">
      <di:waypoint x="188" y="120"/>
      <di:waypoint x="${currentX + 25}" y="120"/>
    </bpmndi:BPMNEdge>`
    });
    
    currentX += 150;
    
    // Add all first steps in parallel branches
    const firstStepYPositions = firstSteps.length === 2 ? [40, 160] : 
                                 firstSteps.length === 3 ? [20, 120, 220] :
                                 firstSteps.map((_, i) => 20 + (i * 100));
    
    firstSteps.forEach((step: any, idx: number) => {
      const yPos = firstStepYPositions[idx];
      const userTaskId = step.step_external_id || `UserTask_First_${idx + 1}`;
      
      elements.push({
        xml: `  <bpmn:userTask id="${userTaskId}" name="${step.name}">
    <bpmn:incoming>Flow_Gateway_${userTaskId}</bpmn:incoming>
    <bpmn:outgoing>Flow_${userTaskId}_Join</bpmn:outgoing>
  </bpmn:userTask>`,
        shape: `    <bpmndi:BPMNShape id="Shape_${userTaskId}" bpmnElement="${userTaskId}">
      <dc:Bounds x="${currentX}" y="${yPos}" width="100" height="80"/>
    </bpmndi:BPMNShape>`,
        id: userTaskId,
        xPos: currentX,
        incoming: [`Flow_Gateway_${userTaskId}`],
        outgoing: [`Flow_${userTaskId}_Join`]
      });
      
      // Flow from gateway to first step
      flows.push({
        xml: `  <bpmn:sequenceFlow id="Flow_Gateway_${userTaskId}" sourceRef="Gateway_Split" targetRef="${userTaskId}"/>`,
        edge: `    <bpmndi:BPMNEdge id="Edge_Gateway_${userTaskId}" bpmnElement="Flow_Gateway_${userTaskId}">
      <di:waypoint x="${currentX - 125}" y="120"/>
      <di:waypoint x="${currentX - 125}" y="${yPos + 40}"/>
      <di:waypoint x="${currentX}" y="${yPos + 40}"/>
    </bpmndi:BPMNEdge>`
      });
    });
    
    currentX += 200;
    
    // Add inclusive gateway join
    elements.push({
      xml: `  <bpmn:inclusiveGateway id="Gateway_Join" name="Join"/>`,
      shape: `    <bpmndi:BPMNShape id="Shape_Gateway_Join" bpmnElement="Gateway_Join">
      <dc:Bounds x="${currentX}" y="95" width="50" height="50"/>
    </bpmndi:BPMNShape>`,
      id: 'Gateway_Join',
      xPos: currentX,
      incoming: firstSteps.map((step, idx) => `Flow_${step.step_external_id || `UserTask_First_${idx + 1}`}_Join`),
      outgoing: otherSteps.length > 0 ? [`Flow_Seq_1`] : ['Flow_To_End']
    });
    
    // Flows from first steps to join gateway
    firstSteps.forEach((step: any, idx: number) => {
      const userTaskId = step.step_external_id || `UserTask_First_${idx + 1}`;
      const yPos = firstStepYPositions[idx];
      
      flows.push({
        xml: `  <bpmn:sequenceFlow id="Flow_${userTaskId}_Join" sourceRef="${userTaskId}" targetRef="Gateway_Join"/>`,
        edge: `    <bpmndi:BPMNEdge id="Edge_${userTaskId}_Join" bpmnElement="Flow_${userTaskId}_Join">
      <di:waypoint x="${currentX - 100}" y="${yPos + 40}"/>
      <di:waypoint x="${currentX + 25}" y="${yPos + 40}"/>
      <di:waypoint x="${currentX + 25}" y="120"/>
    </bpmndi:BPMNEdge>`
      });
    });
    
    currentX += 150;
  }
  
  // Add remaining steps sequentially
  // If we have exactly one first step, put it first, then add others
  // If we have multiple first steps, they're already handled above, so just add the rest
  // If we have no first steps, just add all steps in order
  const sequentialSteps = hasMultipleFirstSteps 
    ? otherSteps 
    : (firstSteps.length === 1 ? [...firstSteps, ...otherSteps] : steps);
  
  sequentialSteps.forEach((step: any, idx: number) => {
    const userTaskId = step.step_external_id || `UserTask_${idx + 1}`;
    const incomingFlowId = `Flow_Seq_${idx + 1}`;
    const outgoingFlowId = idx < sequentialSteps.length - 1 ? `Flow_Seq_${idx + 2}` : 'Flow_To_End';
    
    elements.push({
      xml: `  <bpmn:userTask id="${userTaskId}" name="${step.name}">
    <bpmn:incoming>${incomingFlowId}</bpmn:incoming>
    <bpmn:outgoing>${outgoingFlowId}</bpmn:outgoing>
  </bpmn:userTask>`,
      shape: `    <bpmndi:BPMNShape id="Shape_${userTaskId}" bpmnElement="${userTaskId}">
      <dc:Bounds x="${currentX}" y="80" width="100" height="80"/>
    </bpmndi:BPMNShape>`,
      id: userTaskId,
      xPos: currentX,
      incoming: [incomingFlowId],
      outgoing: [outgoingFlowId]
    });
    
    // Flow from previous element
    const sourceId = idx === 0 ? (hasMultipleFirstSteps ? 'Gateway_Join' : 'StartEvent_1') : (sequentialSteps[idx - 1]?.step_external_id || `UserTask_${idx}`);
    const sourceX = idx === 0 ? (hasMultipleFirstSteps ? currentX - 125 : 188) : currentX - 100;
    
    flows.push({
      xml: `  <bpmn:sequenceFlow id="${incomingFlowId}" sourceRef="${sourceId}" targetRef="${userTaskId}"/>`,
      edge: `    <bpmndi:BPMNEdge id="Edge_Seq_${idx + 1}" bpmnElement="${incomingFlowId}">
      <di:waypoint x="${sourceX}" y="120"/>
      <di:waypoint x="${currentX}" y="120"/>
    </bpmndi:BPMNEdge>`
    });
    
    currentX += 200;
  });
  
  // Flow to end event
  const lastElementId = sequentialSteps.length > 0 
    ? (sequentialSteps[sequentialSteps.length - 1]?.step_external_id || `UserTask_${sequentialSteps.length}`)
    : (hasMultipleFirstSteps ? 'Gateway_Join' : 'StartEvent_1');
  const lastElementX = currentX - 100;
  
  flows.push({
    xml: `  <bpmn:sequenceFlow id="Flow_To_End" sourceRef="${lastElementId}" targetRef="EndEvent_1"/>`,
    edge: `    <bpmndi:BPMNEdge id="Edge_To_End" bpmnElement="Flow_To_End">
      <di:waypoint x="${lastElementX}" y="120"/>
      <di:waypoint x="${currentX + 12}" y="120"/>
    </bpmndi:BPMNEdge>`
  });
  
  const endEventX = currentX + 12;

  // Add start event outgoing reference
  const startOutgoing = hasMultipleFirstSteps ? 'Flow_Start_Gateway' : 'Flow_Seq_1';
  const endIncoming = 'Flow_To_End';

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
  id="Defs_Main_${serviceId}" targetNamespace="http://camunda.org/examples">
  <bpmn:process id="${serviceId}" name="${serviceName}" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Start">
      <bpmn:outgoing>${startOutgoing}</bpmn:outgoing>
    </bpmn:startEvent>
${elements.map(e => e.xml).join('\n')}
    <bpmn:endEvent id="EndEvent_1" name="End">
      <bpmn:incoming>${endIncoming}</bpmn:incoming>
    </bpmn:endEvent>
${flows.map(f => f.xml).join('\n')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_${serviceId}">
    <bpmndi:BPMNPlane id="BPMNPlane_${serviceId}" bpmnElement="${serviceId}">
      <bpmndi:BPMNShape id="Shape_Start" bpmnElement="StartEvent_1">
        <dc:Bounds x="152" y="102" width="36" height="36"/>
      </bpmndi:BPMNShape>
${elements.map(e => e.shape).join('\n')}
      <bpmndi:BPMNShape id="Shape_End" bpmnElement="EndEvent_1">
        <dc:Bounds x="${endEventX}" y="102" width="36" height="36"/>
      </bpmndi:BPMNShape>
${flows.map(f => f.edge).join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let service_external_id: string | undefined;
  let job_id: string | undefined;
  
  try {
    const body = await req.json();
    service_external_id = body.service_external_id;
    job_id = body.job_id;
    
    if (!service_external_id) {
      return new Response(
        JSON.stringify({ error: 'service_external_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!job_id) {
      return new Response(
        JSON.stringify({ error: 'job_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
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

    // Update job status to running with progress tracking
    const totalSteps = await supabase
      .from('mds_data')
      .select('*', { count: 'exact', head: true })
      .eq('service_external_id', service_external_id);
    
    const total = (totalSteps.count || 0) + 1; // +1 for main process
    
    await supabase
      .from('jobs')
      .update({ 
        status: 'running',
        started_at: new Date().toISOString(),
        progress: 0,
        total: total
      })
      .eq('id', job_id);

    // Fetch MDS data - order by process_step first (nulls last), then by step_external_id
    const { data: mdsData, error: mdsError } = await supabase
      .from('mds_data')
      .select('*')
      .eq('service_external_id', service_external_id)
      .order('process_step', { nullsFirst: false })
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

    // Pre-save a minimal fallback main BPMN so the editor can open immediately
    try {
      const prefillXml = FALLBACK_MAIN_TEMPLATE(serviceData.name, service_external_id);
      await supabase
        .from('manual_services')
        .update({
          original_bpmn_xml: prefillXml,
          last_analysis: new Date().toISOString(),
        })
        .eq('id', service_external_id);
      console.log('Prefilled manual_services with fallback main BPMN');
    } catch (e) {
      console.warn('Failed to prefill fallback main BPMN (continuing):', e);
    }

    // Fetch PDF documents
    const { data: documents } = await supabase
      .from('documents')
      .select('*')
      .eq('service_external_id', service_external_id)
      .eq('status', 'downloaded');


    console.log(`Found ${documents?.length || 0} documents`);

    // Build steps with their PDF information - deduplicate by step_external_id
    const stepMap = new Map();
    for (const row of mdsData) {
      if (!stepMap.has(row.step_external_id)) {
        stepMap.set(row.step_external_id, {
          step_external_id: row.step_external_id,
          name: row.step_name,
          type: row.type || 'regular',
          candidate_group: row.candidate_group,
          process_step: row.process_step,
          allUrls: [],
        });
      }
      const step = stepMap.get(row.step_external_id);
      
      // Accumulate URLs from all rows for this step
      const sopUrls = row.sop_urls?.split(',').map((u: string) => u.trim()).filter(Boolean) || [];
      const decisionUrls = row.decision_sheet_urls?.split(',').map((u: string) => u.trim()).filter(Boolean) || [];
      step.allUrls.push(...sopUrls, ...decisionUrls);
    }
    
    // Now build stepsInfo with all accumulated documents per step
    const stepsInfo = Array.from(stepMap.values()).map((step: any) => {
      const stepDocs = documents?.filter((doc: any) => 
        step.allUrls.some((url: string) => doc.source_url === url)
      ) || [];

      const sop_texts = stepDocs.map((doc: any) => 
        `Document: ${doc.source_url}\nStatus: ${doc.status}`
      );

      return {
        step_external_id: step.step_external_id,
        name: step.name,
        type: step.type,
        candidate_group: step.candidate_group,
        process_step: step.process_step,
        sop_texts,
        pdf_urls: step.allUrls
      };
    });
    
    // Sort steps: first steps (process_step = 1) first, then others by step_external_id
    stepsInfo.sort((a: any, b: any) => {
      const aIsFirst = a.process_step === 1;
      const bIsFirst = b.process_step === 1;
      
      if (aIsFirst && !bIsFirst) return -1;
      if (!aIsFirst && bIsFirst) return 1;
      
      // Both are first or both are not first, sort by step_external_id
      return String(a.step_external_id).localeCompare(String(b.step_external_id));
    });

    console.log('Generating subprocess BPMNs...');
    const subprocesses = [];
    let completedSubprocesses = 0;

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
- Use process id="${step.step_external_id}" name="${step.name}" isExecutable="true"
- Default to bpmn:userTask unless the text clearly implies automation (then bpmn:serviceTask)
- If candidate_group is present, add Camunda 8 task assignment using zeebe:taskHeaders:
  <bpmn:extensionElements>
    <zeebe:taskDefinition type="user-task" />
    <zeebe:taskHeaders>
      <zeebe:header key="candidateGroups" value="${step.candidate_group || ''}" />
    </zeebe:taskHeaders>
  </bpmn:extensionElements>
- Create 3-9 logical tasks based on the content
- Include ONE bpmn:startEvent and ONE bpmn:endEvent
- Connect all elements with bpmn:sequenceFlow

CRITICAL: Include complete <bpmndi:BPMNDiagram> section:
- Layout tasks horizontally starting at x=150, y=80
- Space tasks 180px apart horizontally (x positions: 150, 330, 510, 690, etc.)
- Use standard dimensions: tasks (100x80), events (36x36), gateways (50x50)
- StartEvent at x=152, y=102
- Tasks at y=80 with height=80
- EndEvent after last task
- Include BPMNShape for every element and BPMNEdge for every flow

Use proper Camunda 8 namespaces (zeebe, not camunda).
Return only valid BPMN 2.0 XML, no other text.`;

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
      
      // Update progress
      completedSubprocesses++;
      await supabase
        .from('jobs')
        .update({ progress: completedSubprocesses })
        .eq('id', job_id);
    }

    console.log('Generating main process BPMN...');
    
    // Identify first steps
    const firstSteps = stepsInfo.filter((step: any) => step.process_step === 1);
    const hasMultipleFirstSteps = firstSteps.length > 1;
    
    // Generate main process with userTasks
    const mainPrompt = `Create a main BPMN process that orchestrates the following steps using userTasks.

Service Name: ${serviceData.name}
Service ID: ${service_external_id}
Performing Team: ${serviceData.performing_team}
Performer Org: ${serviceData.performer_org}

CRITICAL: Steps are listed in execution order. The first ${firstSteps.length} step(s) marked [FIRST STEP] must be the first to execute after the start event.

Steps (in execution order):
${stepsInfo.map((step: any, idx: number) => `${idx + 1}. ${step.name} (${step.type}${step.candidate_group ? ', group: ' + step.candidate_group : ''})${step.process_step === 1 ? ' [FIRST STEP]' : ''}`).join('\n')}

${hasMultipleFirstSteps ? `
IMPORTANT: Multiple steps are marked as FIRST STEPS. You MUST:
1. After the startEvent, create an bpmn:inclusiveGateway
2. Connect the startEvent to this inclusiveGateway
3. Connect the inclusiveGateway to ALL steps marked as [FIRST STEP]: ${firstSteps.map((s: any) => s.name).join(', ')}
4. These parallel branches should converge later in the process flow
` : `
The first step (marked [FIRST STEP]) must connect directly from the start event.
All other steps follow sequentially.`}

Instructions:
- Use process id="${service_external_id}" name="${serviceData.name}" isExecutable="true"
- For each step, create a bpmn:userTask:
  <bpmn:userTask id="UserTask_[index]" name="[step name]"></bpmn:userTask>
- If branching is implied by step names or multiple first steps exist, add appropriate gateways (inclusiveGateway for multiple first steps)
- Otherwise connect steps sequentially
- Include ONE bpmn:startEvent at the beginning
- Include ONE bpmn:endEvent at the end

CRITICAL: Include complete <bpmndi:BPMNDiagram> section:
- Layout userTasks horizontally starting at x=150, y=80
- Space elements 200px apart (x positions: 150, 350, 550, 750, etc.)
- Use dimensions: userTasks (100x80), events (36x36), gateways (50x50)
- StartEvent at x=152, y=102
- UserTasks at y=80 with height=80
- If using inclusiveGateway for multiple first steps, position it at x=250 between start and first userTasks
- Include BPMNShape for every element and BPMNEdge for every sequence flow with proper waypoints

Use proper Camunda 8 namespaces (zeebe, not camunda).
Return only valid BPMN 2.0 XML, no other text.`;

    let main_bpmn_xml: string;
    try {
      const mainXmlResponse = await callClaude(mainPrompt, ANTHROPIC_API_KEY);
      main_bpmn_xml = extractXML(mainXmlResponse);
      
      // Validate the generated XML is complete
      if (!isCompleteXML(main_bpmn_xml)) {
        throw new Error('Generated XML is incomplete or malformed');
      }
      
      console.log('✓ Generated main process');
    } catch (error) {
      console.error('Failed to generate valid main process, using fallback:', error);
      
      // Generate fallback with CallActivities for all steps
      main_bpmn_xml = generateFallbackMainBPMN(serviceData.name, service_external_id, stepsInfo);
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

    // Generate and upsert service/step descriptions using AI
    try {
      // Extract UserTasks from main BPMN to map ids to names
      const utMatches = Array.from(main_bpmn_xml.matchAll(/<bpmn:userTask[^>]*id=\"([^\"]+)\"[^>]*name=\"([^\"]+)\"/g));
      const userTasks = utMatches.map((m) => ({ id: m[1], name: m[2] }));

      const stepsList = userTasks.map((ut) => `- ${ut.name}`).join('\n');
      const descPrompt = `You are writing short process descriptions. For the service "${serviceData.name}", write a concise service description (<=2 sentences). Then write concise descriptions (<=2 sentences) for each listed step. Return STRICT JSON only with structure: {\n  "serviceDescription": "...",\n  "steps": [ { "name": "Step Name", "description": "..." } ]\n}\n\nSteps:\n${stepsList}`;

      const descText = await callClaude(descPrompt, ANTHROPIC_API_KEY);
      let jsonStr = descText.trim().replace(/```json|```/g, '').trim();
      let parsed: any = null;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (_) {
        const m = descText.match(/\{[\s\S]*\}/);
        if (m) {
          try { parsed = JSON.parse(m[0]); } catch {} 
        }
      }

      const serviceDescription = String(parsed?.serviceDescription || '').trim();
      const stepDescByName = new Map<string, string>();
      for (const s of (parsed?.steps || [])) {
        if (s?.name && s?.description) stepDescByName.set(String(s.name), String(s.description));
      }

      const rows: Array<{ service_key: string; node_id: string | null; step_description: string | null; service_description: string | null; updated_at: string; }> = [];
      if (serviceDescription) {
        rows.push({
          service_key: service_external_id,
          node_id: null,
          step_description: null,
          service_description: serviceDescription,
          updated_at: new Date().toISOString()
        });
      }

      for (const ut of userTasks) {
        const desc = (stepDescByName.get(ut.name) || '').trim();
        if (desc) {
          rows.push({
            service_key: service_external_id,
            node_id: ut.id,
            step_description: desc,
            service_description: null,
            updated_at: new Date().toISOString()
          });
        }
      }

      if (rows.length) {
        const { error: upsertErr } = await supabase
          .from('step_descriptions')
          .upsert(rows, { onConflict: 'service_key,node_id' });
        if (upsertErr) {
          console.error('Failed to upsert step_descriptions:', upsertErr);
        } else {
          console.log(`Upserted ${rows.length} description rows for service ${serviceData.name}`);
        }
      }
    } catch (e) {
      console.warn('Description generation skipped:', e);
    }

    // Create subprocesses and manual_service_steps (using deduplicated stepsInfo)
    for (let i = 0; i < stepsInfo.length; i++) {
      const step = stepsInfo[i];
      const subprocessData = subprocesses.find((sp: any) => sp.step_external_id === step.step_external_id);

      if (!subprocessData) {
        console.error(`No subprocess found for step ${step.step_external_id}`);
        continue;
      }

      // Create subprocess
      const { data: subprocess, error: subprocessError } = await supabase
        .from('subprocesses')
        .insert({
          service_id: service_external_id,
          name: step.name,
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
          name: step.name,
          description: step.name,
          step_order: step.process_step || (i + 1),
          original_order: step.process_step || (i + 1),
          candidate_group: step.candidate_group,
        });

      console.log(`✓ Created subprocess and step for: ${step.name}`);
    }

    console.log('Process generation completed successfully');

    // Mark job as completed
    await supabase
      .from('jobs')
      .update({ 
        status: 'completed',
        progress: total,
        completed_at: new Date().toISOString()
      })
      .eq('id', job_id);

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
    
    // Mark job as failed with specific job_id
    if (job_id) {
      try {
        await supabase
          .from('jobs')
          .update({
            status: 'failed',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            completed_at: new Date().toISOString(),
          })
          .eq('id', job_id);
      } catch (e) {
        console.error('Failed to update job status:', e);
      }
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
