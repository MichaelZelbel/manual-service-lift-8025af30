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

    // Generate signed URLs for all files (including subdirectories)
    const files = [];
    for (const file of filesData || []) {
      if (file.name === '.emptyFolderPlaceholder') continue;

      // Check if it's a directory (has no id, or in Supabase storage terms, has metadata indicating it's a folder)
      // Directories typically have no 'id' or their name doesn't have an extension
      const isDirectory = !file.id || file.name === 'subprocesses' || file.name === 'forms';
      
      if (isDirectory) {
        // List files within subdirectory
        const subPath = `${folderPath}/${file.name}`;
        const { data: subFiles } = await supabase.storage
          .from('exports')
          .list(subPath, { limit: 1000 });
        
        for (const subFile of subFiles || []) {
          if (subFile.name === '.emptyFolderPlaceholder') continue;
          
          const subFilePath = `${subPath}/${subFile.name}`;
          const { data: urlData } = await supabase.storage
            .from('exports')
            .createSignedUrl(subFilePath, 3600);

          let fileType = 'unknown';
          let metadata = {};

          const relativeName = `${file.name}/${subFile.name}`;
          
          if (relativeName.startsWith('subprocesses/') && relativeName.endsWith('.bpmn')) {
            fileType = 'bpmn-sub';
            if (manifest?.bpmn?.subprocesses) {
              const subInfo = manifest.bpmn.subprocesses.find((s: any) => 
                relativeName.includes(s.filename) || s.filename.includes(relativeName)
              );
              if (subInfo) {
                metadata = {
                  stepExternalId: subInfo.stepExternalId,
                  taskName: subInfo.taskName,
                  calledElement: subInfo.calledElement
                };
              }
            }
          } else if (relativeName.startsWith('forms/') && relativeName.endsWith('.form')) {
            fileType = 'form';
          }

          files.push({
            name: relativeName,
            type: fileType,
            signedUrl: urlData?.signedUrl || '',
            ...metadata
          });
        }
        continue;
      }

      // Handle files at the root level
      const filePath = `${folderPath}/${file.name}`;
      const { data: urlData } = await supabase.storage
        .from('exports')
        .createSignedUrl(filePath, 3600);

      let fileType = 'unknown';
      let metadata = {};

      if (file.name === 'manual-service.bpmn') {
        fileType = 'bpmn-main';
      } else if (file.name === 'manifest.json') {
        fileType = 'meta';
      } else if (file.name === 'package.zip') {
        fileType = 'zip';
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
