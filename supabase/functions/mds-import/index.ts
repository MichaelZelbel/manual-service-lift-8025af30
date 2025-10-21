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
}

function generateRowHash(row: MDSRow): string {
  const hashInput = `${row.service_external_id}|${row.step_external_id}|${row.step_name}|${row.type}|${row.candidate_group}|${row.sop_urls}|${row.decision_sheet_urls}`;
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
            row_hash: rowHash,
          }, {
            onConflict: 'service_external_id,step_external_id'
          });

        if (upsertError) {
          console.error('Upsert error:', upsertError);
          skipped++;
          continue;
        }

        // Check if this is a new insert or update based on row_hash
        const { data: existingRow } = await supabase
          .from('mds_data')
          .select('row_hash')
          .eq('service_external_id', row.service_external_id)
          .eq('step_external_id', row.step_external_id)
          .single();

        if (existingRow && existingRow.row_hash !== rowHash) {
          updated++;
        } else if (!existingRow) {
          inserted++;
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

    // Queue jobs for each unique service
    for (const serviceId of servicesEnqueued) {
      // Queue PDF fetch job
      await supabase.from('jobs').insert({
        service_external_id: serviceId,
        job_type: 'pdf_fetch',
        status: 'queued',
      });

      // Queue process generation job (will run after PDFs are fetched)
      await supabase.from('jobs').insert({
        service_external_id: serviceId,
        job_type: 'process_generation',
        status: 'queued',
      });
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
