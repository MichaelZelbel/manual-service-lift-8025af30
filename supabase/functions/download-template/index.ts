import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Template name to filename mapping
const TEMPLATE_MAP: Record<string, string> = {
  'FIRST_STEP_SINGLE': 'first-step-single-path.form',
  'FIRST_STEP_MULTI': 'first-step-multi-path.form',
  'NEXT_STEP_SINGLE': 'next-step-single-path.form',
  'NEXT_STEP_MULTI': 'next-step-multi-path.form',
  'START_NODE': 'start-node.form',
  'TASK_NODE': 'task-node.form',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Download template request received');

    // Parse query parameters
    const url = new URL(req.url);
    const templateName = url.searchParams.get('template_name');

    if (!templateName) {
      return new Response(
        JSON.stringify({ error: 'Missing template_name parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate template name
    const fileName = TEMPLATE_MAP[templateName];
    if (!fileName) {
      return new Response(
        JSON.stringify({ error: 'Invalid template name' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating signed URL for:', fileName);

    // Create Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Generate signed URL (valid for 1 hour)
    const { data, error } = await supabase.storage
      .from('form_templates')
      .createSignedUrl(fileName, 3600);

    if (error) {
      console.error('Signed URL error:', error);
      return new Response(
        JSON.stringify({ error: `Failed to generate download URL: ${error.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!data?.signedUrl) {
      return new Response(
        JSON.stringify({ error: 'No file uploaded for this template yet' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Signed URL generated successfully');

    return new Response(
      JSON.stringify({ ok: true, signed_url: data.signedUrl }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Download error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
