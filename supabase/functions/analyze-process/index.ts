import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { serviceId } = await req.json();

    if (!serviceId) {
      return new Response(JSON.stringify({ error: 'Service ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');

    if (!anthropicApiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch main process
    const { data: service, error: serviceError } = await supabase
      .from('manual_services')
      .select('id, name, edited_bpmn_xml, original_bpmn_xml')
      .eq('id', serviceId)
      .single();

    if (serviceError || !service) {
      console.error('Error fetching service:', serviceError);
      return new Response(JSON.stringify({ error: 'Service not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch all subprocesses for this service
    const { data: subprocesses, error: subprocessError } = await supabase
      .from('subprocesses')
      .select('id, name, edited_bpmn_xml, original_bpmn_xml')
      .eq('service_id', serviceId);

    if (subprocessError) {
      console.error('Error fetching subprocesses:', subprocessError);
    }

    // Build the JSON payload
    const bpmnData = {
      context: "All BPMN files for one Manual Service of an international bank.",
      mainProcess: {
        title: service.name,
        bpmnXml: service.edited_bpmn_xml || service.original_bpmn_xml || ''
      },
      subprocesses: (subprocesses || []).map(sub => ({
        stepName: sub.name,
        bpmnXml: sub.edited_bpmn_xml || sub.original_bpmn_xml || ''
      }))
    };

    const systemPrompt = `You are a senior process-optimization consultant analyzing BPMN business processes for an international bank. 
Focus on business efficiency, consistency, and maturity—not syntax or diagram correctness.
Identify improvement opportunities, repeated patterns, and potential standardizations across similar processes.
Write the analysis as a clear executive narrative with actionable recommendations.`;

    const userPrompt = `Please review the following BPMN processes:

${JSON.stringify(bpmnData, null, 2)}

Tasks:
- Summarize what this process seems to accomplish.
- Evaluate efficiency: are there redundant steps, manual handoffs, or unclear responsibilities?
- Evaluate consistency between subprocesses and the main process.
- Assess overall process maturity: clarity of decisions, automation potential, data flow quality.
- Highlight repeating patterns or structures.
- Speculate which of these patterns are likely repeated in other banking processes (without naming the bank).
- Provide concise, actionable recommendations for improvement.

Return your findings in natural text, with short sections and bullet points where useful.`;

    console.log('Calling Claude API...');
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 3000,
        temperature: 0.4,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', response.status, errorText);
      return new Response(JSON.stringify({ error: 'Failed to analyze process' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const analysisText = data.content[0].text;

    console.log('Analysis completed successfully');

    return new Response(JSON.stringify({ analysis: analysisText }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-process function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
