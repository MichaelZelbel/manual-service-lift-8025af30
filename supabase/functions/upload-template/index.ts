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

const DISPLAY_NAMES: Record<string, string> = {
  'FIRST_STEP_SINGLE': 'First Step, Single Path',
  'FIRST_STEP_MULTI': 'First Step, Multi Path',
  'NEXT_STEP_SINGLE': 'Next Step, Single Path',
  'NEXT_STEP_MULTI': 'Next Step, Multi Path',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Upload template request received');

    // Create Supabase client with service role key for storage access
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse multipart form data
    const formData = await req.formData();
    const templateName = formData.get('template_name') as string;
    const file = formData.get('file') as File;
    const uploadedBy = formData.get('uploaded_by') as string;

    console.log('Template name:', templateName);
    console.log('Uploaded by:', uploadedBy);

    if (!templateName || !file) {
      return new Response(
        JSON.stringify({ error: 'Missing template_name or file' }),
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

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ error: 'File too large (max 2 MB)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate file type
    const contentType = file.type;
    if (contentType !== 'application/json' && contentType !== 'text/plain') {
      return new Response(
        JSON.stringify({ error: 'Unsupported file type. Upload a Camunda Webform JSON (.form/.json)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Uploading file to storage:', fileName);

    // Read file content
    const fileContent = await file.arrayBuffer();

    // Upload to storage bucket
    const { error: uploadError } = await supabase.storage
      .from('form_templates')
      .upload(fileName, fileContent, {
        upsert: true,
        contentType: 'application/json',
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: `Storage upload failed: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('File uploaded successfully, updating database');

    // Update form_templates table
    const now = new Date().toISOString();
    const { error: dbError } = await supabase
      .from('form_templates')
      .update({
        last_updated: now,
        uploaded_by: uploadedBy,
      })
      .eq('template_name', templateName);

    if (dbError) {
      console.error('Database update error:', dbError);
      return new Response(
        JSON.stringify({ error: `Database update failed: ${dbError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Template uploaded successfully');

    return new Response(
      JSON.stringify({
        ok: true,
        file_name: fileName,
        last_updated: now,
        display_name: DISPLAY_NAMES[templateName],
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Upload error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
