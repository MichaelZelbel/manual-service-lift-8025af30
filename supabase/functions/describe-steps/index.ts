import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface StepSummary {
  nodeId: string;
  stepDescription: string;
}

interface RequestBody {
  serviceKey: string;
  serviceDescription?: string;
  steps?: StepSummary[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body: RequestBody = await req.json();
    const { serviceKey, serviceDescription, steps } = body;

    if (!serviceKey) {
      return new Response(
        JSON.stringify({ error: 'serviceKey is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rows: Array<{
      service_key: string;
      node_id: string | null;
      step_description: string | null;
      service_description: string | null;
      updated_at: string;
    }> = [];

    // Add service-level description
    if (typeof serviceDescription === 'string' && serviceDescription.trim()) {
      rows.push({
        service_key: serviceKey,
        node_id: null,
        step_description: null,
        service_description: serviceDescription.trim(),
        updated_at: new Date().toISOString()
      });
    }

    // Add step descriptions
    if (Array.isArray(steps)) {
      for (const step of steps) {
        if (step?.nodeId && typeof step.stepDescription === 'string' && step.stepDescription.trim()) {
          rows.push({
            service_key: serviceKey,
            node_id: step.nodeId,
            step_description: step.stepDescription.trim(),
            service_description: null,
            updated_at: new Date().toISOString()
          });
        }
      }
    }

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'no valid rows to insert' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Upserting ${rows.length} description(s) for service: ${serviceKey}`);

    const { error } = await supabase
      .from('step_descriptions')
      .upsert(rows, { onConflict: 'service_key,node_id' });

    if (error) {
      console.error('Upsert error:', error);
      throw error;
    }

    return new Response(
      JSON.stringify({ ok: true, upserted: rows.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('describe-steps error:', error);
    const message = error instanceof Error ? error.message : 'internal error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
