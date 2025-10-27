import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bpmnXml, isManualService } = await req.json();
    
    if (!bpmnXml) {
      throw new Error('BPMN XML is required');
    }

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    const systemPrompt = "You are a BPMN 2.0 process expert. Assess the structural correctness of a BPMN process and describe any formal or logical issues in clear, human language. Be extremely concise, clear, and friendly with a touch of humor. IMPORTANT: If the process looks good with no problems, keep your response to just 1 sentence expressing that it looks solid. Only provide longer responses if there are actual problems. Do NOT list all the things that are correct - focus on problems only. Add a blank line between each sentence for readability. Format your response using Markdown. Do not output XML or code.";

    let userPrompt = `Please analyse the following BPMN process and tell me if it makes formal sense.

Check for:
- Is there a path from the Start Event to every task?
- Is there a path from every task to at least one End Event?
- Are gateways used where branching is needed?
- Are there dangling or disconnected tasks?
- Anything that looks structurally odd or could cause runtime issues.`;

    if (isManualService) {
      userPrompt += `

Also, this is a *Manual Service* process. Between Start and End, every high-level step should normally be modeled as a CallActivity linked to a subprocess. If any step is a plain Task or UserTask instead, please mention that as a potential missing subprocess.`;
    }

    userPrompt += `

Keep your response extremely brief and to the point. If the process looks good, just say so in 1 sentence. Only provide detailed feedback if there are actual problems. Add a blank line between each sentence for readability.

Here is the BPMN XML:
${bpmnXml}`;

    console.log('Sending request to Claude...');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 5000,
        temperature: 0.2,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', response.status, errorText);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('Received response from Claude');

    const assessment = data.content[0].text;

    return new Response(
      JSON.stringify({ assessment }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in check-bpmn function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
