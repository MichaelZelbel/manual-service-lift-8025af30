import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import { crypto } from 'https://deno.land/std@0.224.0/crypto/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sha1Hash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('PDF fetch job request received');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { service_external_id } = await req.json();

    if (!service_external_id) {
      return new Response(
        JSON.stringify({ error: 'Missing service_external_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Fetching PDFs for service: ${service_external_id}`);

    // Get all MDS rows for this service
    const { data: mdsRows, error: mdsError } = await supabase
      .from('mds_data')
      .select('*')
      .eq('service_external_id', service_external_id);

    if (mdsError || !mdsRows) {
      throw new Error(`Failed to fetch MDS data: ${mdsError?.message}`);
    }

    // Collect all unique URLs
    const urlsToFetch: { url: string; isDecisionSheet: boolean }[] = [];
    
    for (const row of mdsRows) {
      if (row.sop_urls) {
        const sopUrls = row.sop_urls.split(';').map((u: string) => u.trim()).filter(Boolean);
        sopUrls.forEach((url: string) => {
          if (!urlsToFetch.some(u => u.url === url)) {
            urlsToFetch.push({ url, isDecisionSheet: false });
          }
        });
      }
      
      if (row.decision_sheet_urls) {
        const dsUrls = row.decision_sheet_urls.split(';').map((u: string) => u.trim()).filter(Boolean);
        dsUrls.forEach((url: string) => {
          if (!urlsToFetch.some(u => u.url === url)) {
            urlsToFetch.push({ url, isDecisionSheet: true });
          }
        });
      }
    }

    console.log(`Found ${urlsToFetch.length} unique URLs to fetch`);

    let successCount = 0;
    let failCount = 0;

    // Update job status
    await supabase
      .from('jobs')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
        total: urlsToFetch.length,
      })
      .eq('service_external_id', service_external_id)
      .eq('job_type', 'pdf_fetch')
      .eq('status', 'queued');

    // Fetch each PDF
    for (const { url, isDecisionSheet } of urlsToFetch) {
      try {
        console.log(`Downloading: ${url}`);
        
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('pdf')) {
          throw new Error(`Not a PDF file: ${contentType}`);
        }

        const pdfData = await response.arrayBuffer();
        
        // Generate filename from URL hash
        const urlHash = await sha1Hash(url);
        const fileName = `${urlHash}.pdf`;
        const filePath = `service/${service_external_id}/${fileName}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('sops')
          .upload(filePath, pdfData, {
            contentType: 'application/pdf',
            upsert: true,
          });

        if (uploadError) {
          throw uploadError;
        }

        // Record in documents table
        await supabase.from('documents').upsert({
          service_external_id,
          source_url: url,
          is_decision_sheet: isDecisionSheet,
          file_path: filePath,
          status: 'downloaded',
          downloaded_at: new Date().toISOString(),
        }, {
          onConflict: 'service_external_id,source_url'
        });

        successCount++;
        
        // Update progress
        await supabase
          .from('jobs')
          .update({ progress: successCount + failCount })
          .eq('service_external_id', service_external_id)
          .eq('job_type', 'pdf_fetch')
          .eq('status', 'running');

        console.log(`Successfully downloaded: ${url}`);
      } catch (error) {
        failCount++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Failed to download ${url}:`, errorMsg);

        // Record failure
        await supabase.from('documents').upsert({
          service_external_id,
          source_url: url,
          is_decision_sheet: isDecisionSheet,
          status: 'failed',
          error_message: errorMsg,
        }, {
          onConflict: 'service_external_id,source_url'
        });

        // Update progress
        await supabase
          .from('jobs')
          .update({ progress: successCount + failCount })
          .eq('service_external_id', service_external_id)
          .eq('job_type', 'pdf_fetch')
          .eq('status', 'running');
      }
    }

    // Mark job as complete
    await supabase
      .from('jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        error_message: failCount > 0 ? `${failCount} files failed to download` : null,
      })
      .eq('service_external_id', service_external_id)
      .eq('job_type', 'pdf_fetch')
      .eq('status', 'running');

    console.log(`PDF fetch complete: ${successCount} succeeded, ${failCount} failed`);

    // Trigger process-generation edge function
    try {
      console.log(`Triggering process-generation for service ${service_external_id}`);
      supabase.functions.invoke('process-generation', {
        body: { service_external_id }
      }).then(() => {
        console.log(`Process generation triggered for service ${service_external_id}`);
      }).catch(err => {
        console.error(`Failed to trigger process-generation for ${service_external_id}:`, err);
      });
    } catch (error) {
      console.error(`Error triggering process-generation for ${service_external_id}:`, error);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        success_count: successCount,
        fail_count: failCount,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('PDF fetch error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
