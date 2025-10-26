import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import JSZip from 'https://esm.sh/jszip@3.10.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FormData {
  filename: string;
  json: any;
}

interface SubprocessBpmn {
  filename: string;
  xml: string;
}

interface UploadRequest {
  serviceId: string;
  serviceName: string;
  updatedBpmnXml: string;
  forms: FormData[];
  subprocessBpmns: SubprocessBpmn[];
  manifest: any;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[upload-export] Request received');
    
    const body: UploadRequest = await req.json();
    const { serviceId, serviceName, updatedBpmnXml, forms, subprocessBpmns, manifest } = body;

    if (!serviceId || !serviceName || !updatedBpmnXml) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: serviceId, serviceName, or updatedBpmnXml' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[upload-export] Processing export for service: ${serviceName} (${serviceId})`);
    console.log(`[upload-export] Forms count: ${forms?.length || 0}, Subprocesses: ${subprocessBpmns?.length || 0}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Create export folder path
    const exportFolder = `${serviceId}/${Date.now()}`;
    console.log(`[upload-export] Export folder: ${exportFolder}`);

    // Build ZIP package
    const zip = new JSZip();
    zip.file('manual-service.bpmn', updatedBpmnXml);
    
    for (const { filename, xml } of subprocessBpmns || []) {
      zip.file(`subprocesses/${filename}`, xml);
    }
    
    for (const form of forms || []) {
      zip.file(`forms/${form.filename}`, JSON.stringify(form.json, null, 2));
    }
    
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    
    const zipBinary = await zip.generateAsync({ type: 'uint8array' });
    console.log('[upload-export] ZIP package created');

    // Upload main BPMN
    const { error: bpmnError } = await supabase.storage
      .from('exports')
      .upload(`${exportFolder}/manual-service.bpmn`, updatedBpmnXml, {
        contentType: 'application/xml',
        upsert: true,
      });

    if (bpmnError) {
      console.error('[upload-export] Failed to upload main BPMN:', bpmnError);
      throw new Error(`Failed to upload main BPMN: ${bpmnError.message}`);
    }
    console.log('[upload-export] Main BPMN uploaded');

    // Upload subprocess BPMNs
    for (const { filename, xml } of subprocessBpmns || []) {
      const { error: subError } = await supabase.storage
        .from('exports')
        .upload(`${exportFolder}/subprocesses/${filename}`, xml, {
          contentType: 'application/xml',
          upsert: true,
        });

      if (subError) {
        console.error(`[upload-export] Failed to upload subprocess ${filename}:`, subError);
        throw new Error(`Failed to upload subprocess ${filename}: ${subError.message}`);
      }
    }
    console.log(`[upload-export] ${subprocessBpmns?.length || 0} subprocess BPMNs uploaded`);

    // Upload forms
    for (const form of forms || []) {
      const { error: formError } = await supabase.storage
        .from('exports')
        .upload(`${exportFolder}/forms/${form.filename}`, JSON.stringify(form.json, null, 2), {
          contentType: 'application/json',
          upsert: true,
        });

      if (formError) {
        console.error(`[upload-export] Failed to upload form ${form.filename}:`, formError);
        throw new Error(`Failed to upload form ${form.filename}: ${formError.message}`);
      }
    }
    console.log(`[upload-export] ${forms?.length || 0} forms uploaded`);

    // Upload manifest
    const { error: manifestError } = await supabase.storage
      .from('exports')
      .upload(`${exportFolder}/manifest.json`, JSON.stringify(manifest, null, 2), {
        contentType: 'application/json',
        upsert: true,
      });

    if (manifestError) {
      console.error('[upload-export] Failed to upload manifest:', manifestError);
      throw new Error(`Failed to upload manifest: ${manifestError.message}`);
    }
    console.log('[upload-export] Manifest uploaded');

    // Upload ZIP package
    const { error: zipError } = await supabase.storage
      .from('exports')
      .upload(`${exportFolder}/package.zip`, zipBinary, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (zipError) {
      console.error('[upload-export] Failed to upload ZIP:', zipError);
      throw new Error(`Failed to upload ZIP: ${zipError.message}`);
    }
    console.log('[upload-export] ZIP package uploaded');

    // Update service timestamps
    const { error: updateError } = await supabase
      .from('manual_services')
      .update({
        last_form_export: new Date().toISOString(),
        last_bpmn_export: new Date().toISOString(),
      })
      .eq('id', serviceId);

    if (updateError) {
      console.error('[upload-export] Failed to update service timestamps:', updateError);
      // Non-fatal, continue
    }

    // Get signed URL for the ZIP
    const { data: zipUrlData } = await supabase.storage
      .from('exports')
      .createSignedUrl(`${exportFolder}/package.zip`, 3600);

    console.log('[upload-export] Export completed successfully');

    return new Response(
      JSON.stringify({
        ok: true,
        exportFolder,
        formsCount: forms?.length || 0,
        subprocessCount: subprocessBpmns?.length || 0,
        signedZipUrl: zipUrlData?.signedUrl || null,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[upload-export] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        details: String(error)
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
