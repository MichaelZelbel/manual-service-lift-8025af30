import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TYPE_MAPPING: Record<string, string> = {
  'regular': 'userTask',
  'fixed': 'userTask',
  'data collection': 'serviceTask',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Process generation request received');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { service_external_id } = await req.json();

    if (!service_external_id) {
      return new Response(
        JSON.stringify({ error: 'Missing service_external_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Generating process for service: ${service_external_id}`);

    // Check if PDF fetch is complete
    const { data: pdfJob } = await supabase
      .from('jobs')
      .select('*')
      .eq('service_external_id', service_external_id)
      .eq('job_type', 'pdf_fetch')
      .single();

    if (!pdfJob || pdfJob.status !== 'completed') {
      return new Response(
        JSON.stringify({ error: 'PDF fetch must complete first' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update job status
    await supabase
      .from('jobs')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .eq('service_external_id', service_external_id)
      .eq('job_type', 'process_generation')
      .eq('status', 'queued');

    // Get MDS data
    const { data: mdsRows, error: mdsError } = await supabase
      .from('mds_data')
      .select('*')
      .eq('service_external_id', service_external_id)
      .order('step_external_id');

    if (mdsError || !mdsRows || mdsRows.length === 0) {
      throw new Error(`Failed to fetch MDS data: ${mdsError?.message || 'No data found'}`);
    }

    // Get service info
    const { data: service } = await supabase
      .from('manual_services')
      .select('*')
      .eq('id', service_external_id)
      .single();

    if (!service) {
      throw new Error('Service not found');
    }

    // Build prompt for Claude with PDF links
    const stepsDescription = mdsRows.map((row: any, idx: number) => {
      const taskType = TYPE_MAPPING[row.type.toLowerCase()] || 'userTask';
      const pdfUrl = row.sop_urls || row.decision_sheet_urls || '';
      return `
Step ${idx + 1}:
- ID: ${row.step_external_id}
- Name: ${row.step_name}
- Type: ${taskType}
- Candidate Group: ${row.candidate_group || 'N/A'}

Please analyze the process described in the following PDF and turn it into a BPMN 2.0 process diagram that can be imported into Camunda 8.
Focus only on Major steps and turn all of them into user tasks. End up with anything between 3 and 20 tasks in the diagram, whatever describes the steps.
Use gates to branch out from one task to multiple other tasks where appropriate.

PDF: ${pdfUrl || 'No PDF provided'}
`;
    }).join('\n\n');

    const prompt = `Given the following manual service steps from an MDS export, produce:
1. A main BPMN process XML with sequential user tasks (one per step)
2. For each step, a subprocess BPMN XML with 5-9 detailed actions based on the PDF content

Service: ${service.name}
Team: ${service.performing_team}
Organization: ${service.performer_org}

Steps with PDF links:
${stepsDescription}

Requirements:
- Use BPMN 2.0 XML format compatible with Camunda 8
- Each main task should reference the step's candidate group as: <bpmn:userTask camunda:candidateGroups="{candidateGroup}">
- Keep subprocess actions human-readable and actionable
- Include gateways only where logically needed based on the PDF content
- Use proper BPMN IDs and naming conventions
- Each subprocess should have 3-20 user tasks based on the PDF

Output format (JSON):
{
  "main_bpmn": "<bpmn:definitions>...</bpmn:definitions>",
  "subprocesses": [
    {
      "step_id": "step_external_id",
      "subprocess_bpmn": "<bpmn:definitions>...</bpmn:definitions>",
      "actions": [
        {"name": "Action 1", "description": "Details"},
        ...
      ]
    }
  ]
}`;

    console.log('Calling Claude Sonnet 4.5 for process generation...');

    // Call Claude Sonnet 4.5 directly
    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 16384,
        system: 'You are a BPMN 2.0 process generation expert. Always return valid JSON in the exact format requested.',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`Claude generation failed: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    console.log('Claude response received, parsing content...');
    
    const generatedContent = aiData.content?.[0]?.text;
    if (!generatedContent) {
      throw new Error('No content generated from Claude');
    }
    
    // Extract JSON from potential markdown code blocks
    let jsonContent = generatedContent;
    const jsonMatch = generatedContent.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonContent = jsonMatch[1];
    }
    
    const processData = JSON.parse(jsonContent);

    console.log('AI generation complete, persisting to database...');

    // Update manual_services with main BPMN
    await supabase
      .from('manual_services')
      .update({
        original_bpmn_xml: processData.main_bpmn,
        last_analysis: new Date().toISOString(),
      })
      .eq('id', service_external_id);

    // Create manual_service_steps and subprocesses
    for (let i = 0; i < mdsRows.length; i++) {
      const row = mdsRows[i];
      const subprocessData = processData.subprocesses.find((sp: any) => sp.step_id === row.step_external_id);

      // Create subprocess
      const { data: subprocess, error: subprocessError } = await supabase
        .from('subprocesses')
        .insert({
          service_id: service_external_id,
          name: row.step_name,
          original_bpmn_xml: subprocessData?.subprocess_bpmn || null,
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

      // Create subprocess_steps from AI-generated actions
      if (subprocessData?.actions) {
        for (let j = 0; j < subprocessData.actions.length; j++) {
          const action = subprocessData.actions[j];
          await supabase
            .from('subprocess_steps')
            .insert({
              subprocess_id: subprocess.id,
              name: action.name,
              description: action.description || '',
              step_order: j,
              original_order: j,
              candidate_group: row.candidate_group,
            });
        }
      }
    }

    // Mark job as complete
    await supabase
      .from('jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('service_external_id', service_external_id)
      .eq('job_type', 'process_generation')
      .eq('status', 'running');

    console.log('Process generation complete');

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Process generation error:', error);
    
    // Mark job as failed
    const { service_external_id } = await req.json().catch(() => ({}));
    if (service_external_id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      await supabase
        .from('jobs')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          completed_at: new Date().toISOString(),
        })
        .eq('service_external_id', service_external_id)
        .eq('job_type', 'process_generation')
        .eq('status', 'running');
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
