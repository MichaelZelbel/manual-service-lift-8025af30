import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MDSRow {
  service_external_id: string;
  service_name: string;
  performing_team: string;
  performer_org: string;
  step_external_id: string;
  step_name: string;
  type: string;
  candidate_group?: string;
  sop_urls?: string;
  decision_sheet_urls?: string;
  process_step?: number;
}

function generateRowHash(row: MDSRow): string {
  const hashInput = `${row.service_external_id}|${row.step_external_id}|${row.step_name}|${row.type}|${row.candidate_group}|${row.sop_urls}|${row.decision_sheet_urls}|${row.process_step}`;
  return btoa(hashInput);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('MDS import request received');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { rows } = await req.json() as { rows: MDSRow[] };

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid data format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing ${rows.length} rows`);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const servicesEnqueued = new Set<string>();

    // Process each row
    for (const row of rows) {
      try {
        const rowHash = generateRowHash(row);
        
        // Check if row exists before upsert
        const { data: existingRow } = await supabase
          .from('mds_data')
          .select('row_hash')
          .eq('service_external_id', row.service_external_id)
          .eq('step_external_id', row.step_external_id)
          .single();

        // Upsert MDS data
        const { error: upsertError } = await supabase
          .from('mds_data')
          .upsert({
            service_external_id: row.service_external_id,
            service_name: row.service_name,
            performing_team: row.performing_team,
            performer_org: row.performer_org,
            step_external_id: row.step_external_id,
            step_name: row.step_name,
            type: row.type,
            candidate_group: row.candidate_group || null,
            sop_urls: row.sop_urls || null,
            decision_sheet_urls: row.decision_sheet_urls || null,
            process_step: row.process_step || null,
            row_hash: rowHash,
          }, {
            onConflict: 'service_external_id,step_external_id'
          });

        if (upsertError) {
          console.error('Upsert error:', upsertError);
          skipped++;
          continue;
        }

        // Track if this was insert or update
        if (!existingRow) {
          inserted++;
        } else if (existingRow.row_hash !== rowHash) {
          updated++;
        }

        // Ensure manual_services record exists
        const { error: serviceError } = await supabase
          .from('manual_services')
          .upsert({
            id: row.service_external_id,
            name: row.service_name,
            performing_team: row.performing_team,
            performer_org: row.performer_org,
          }, {
            onConflict: 'id',
            ignoreDuplicates: true
          });

        if (!serviceError) {
          servicesEnqueued.add(row.service_external_id);
        }
      } catch (error) {
        console.error('Row processing error:', error);
        skipped++;
      }
    }

    // Queue jobs and trigger processing for each unique service
    for (const serviceId of servicesEnqueued) {
      // Queue PDF fetch job
      const { data: pdfJob } = await supabase.from('jobs').insert({
        service_external_id: serviceId,
        job_type: 'pdf_fetch',
        status: 'queued',
      }).select().single();

      // Queue process generation job (will run after PDFs are fetched)
      await supabase.from('jobs').insert({
        service_external_id: serviceId,
        job_type: 'process_generation',
        status: 'queued',
      });

      // Trigger pdf-fetch edge function immediately
      if (pdfJob) {
        try {
          console.log(`Triggering pdf-fetch for service ${serviceId}`);
          supabase.functions.invoke('pdf-fetch', {
            body: { service_external_id: serviceId }
          }).then(() => {
            console.log(`PDF fetch triggered for service ${serviceId}`);
          }).catch(err => {
            console.error(`Failed to trigger pdf-fetch for ${serviceId}:`, err);
          });
        } catch (error) {
          console.error(`Error triggering pdf-fetch for ${serviceId}:`, error);
        }
      }
    }

    console.log(`Import complete: ${inserted} inserted, ${updated} updated, ${skipped} skipped`);

    return new Response(
      JSON.stringify({
        inserted,
        updated,
        skipped,
        services_enqueued: Array.from(servicesEnqueued),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Import error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
