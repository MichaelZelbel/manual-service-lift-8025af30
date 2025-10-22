import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const serviceId = url.searchParams.get('service_id');
    
    if (!serviceId) {
      return new Response(
        JSON.stringify({ error: 'Missing service_id parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // List all files in the latest export folder for this service
    const { data: listData, error: listError } = await supabase.storage
      .from('exports')
      .list(`${serviceId}`, {
        sortBy: { column: 'created_at', order: 'desc' }
      });

    if (listError) throw listError;
    if (!listData || listData.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No exports found for this service' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the latest timestamp folder
    const latestFolder = listData[0].name;
    const folderPath = `${serviceId}/${latestFolder}`;

    // List all files in this folder
    const { data: filesData, error: filesError } = await supabase.storage
      .from('exports')
      .list(folderPath, { limit: 1000 });

    if (filesError) throw filesError;

    // Load manifest first
    let manifest = null;
    const manifestFile = filesData?.find(f => f.name === 'manifest.json');
    if (manifestFile) {
      const { data: manifestData } = await supabase.storage
        .from('exports')
        .download(`${folderPath}/manifest.json`);
      
      if (manifestData) {
        const text = await manifestData.text();
        manifest = JSON.parse(text);
      }
    }

    // Generate signed URLs for all files
    const files = [];
    for (const file of filesData || []) {
      if (file.name === '.emptyFolderPlaceholder') continue;

      const filePath = `${folderPath}/${file.name}`;
      const { data: urlData } = await supabase.storage
        .from('exports')
        .createSignedUrl(filePath, 3600); // 1 hour expiry

      let fileType = 'unknown';
      let metadata = {};

      if (file.name === 'manual-service.bpmn') {
        fileType = 'bpmn-main';
      } else if (file.name.startsWith('subprocesses/') && file.name.endsWith('.bpmn')) {
        fileType = 'bpmn-sub';
        // Try to find corresponding subprocess info from manifest
        if (manifest?.bpmn?.subprocesses) {
          const subInfo = manifest.bpmn.subprocesses.find((s: any) => 
            file.name.includes(s.filename) || s.filename.includes(file.name)
          );
          if (subInfo) {
            metadata = {
              stepExternalId: subInfo.stepExternalId,
              taskName: subInfo.taskName,
              calledElement: subInfo.calledElement
            };
          }
        }
      } else if (file.name.startsWith('forms/') && file.name.endsWith('.form')) {
        fileType = 'form';
      } else if (file.name === 'manifest.json') {
        fileType = 'meta';
      }

      files.push({
        name: file.name,
        type: fileType,
        signedUrl: urlData?.signedUrl || '',
        ...metadata
      });
    }

    return new Response(
      JSON.stringify({
        folder: folderPath,
        files,
        manifest
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('List exports error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
