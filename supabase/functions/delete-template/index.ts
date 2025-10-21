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
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Delete template request received');

    // Parse request body
    const { template_name } = await req.json();

    if (!template_name) {
      return new Response(
        JSON.stringify({ error: 'Missing template_name' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate template name
    const fileName = TEMPLATE_MAP[template_name];
    if (!fileName) {
      return new Response(
        JSON.stringify({ error: 'Invalid template name' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Deleting file from storage:', fileName);

    // Create Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('form_templates')
      .remove([fileName]);

    if (storageError) {
      console.error('Storage delete error:', storageError);
      return new Response(
        JSON.stringify({ error: `Storage delete failed: ${storageError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('File deleted, updating database');

    // Update form_templates table to clear metadata
    const now = new Date().toISOString();
    const { error: dbError } = await supabase
      .from('form_templates')
      .update({
        uploaded_by: null,
        last_updated: now,
      })
      .eq('template_name', template_name);

    if (dbError) {
      console.error('Database update error:', dbError);
      return new Response(
        JSON.stringify({ error: `Database update failed: ${dbError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Template deleted successfully');

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Delete error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
