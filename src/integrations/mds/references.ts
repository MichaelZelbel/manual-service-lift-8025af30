import { supabase } from "@/integrations/supabase/client";

export type StepRef = { name: string; url: string };
export type RefMap = Record<string, StepRef[]>; // step_external_id -> refs[]

/**
 * Fetch all references (SOPs, Decision Sheets) for a service from MDS data.
 * Returns a map of step_external_id -> array of { name, url }
 */
export async function fetchReferencesForService(serviceKey: string): Promise<RefMap> {
  // Query mds_data table for this service and extract URLs
  const { data, error } = await supabase
    .from("mds_data")
    .select("step_external_id, step_name, sop_urls, decision_sheet_urls")
    .eq("service_external_id", serviceKey);

  if (error || !data) {
    console.error("Error fetching MDS references:", error);
    return {};
  }

  const map: RefMap = {};
  
  for (const row of data) {
    if (!row?.step_external_id) continue;
    
    const refs: StepRef[] = [];
    
    // Parse SOP URLs
    if (row.sop_urls) {
      const sopUrls = row.sop_urls.split(',').map(u => u.trim()).filter(Boolean);
      sopUrls.forEach((url, idx) => {
        refs.push({
          name: `${row.step_name} - SOP${sopUrls.length > 1 ? ` ${idx + 1}` : ''}`,
          url
        });
      });
    }
    
    // Parse Decision Sheet URLs
    if (row.decision_sheet_urls) {
      const dsUrls = row.decision_sheet_urls.split(',').map(u => u.trim()).filter(Boolean);
      dsUrls.forEach((url, idx) => {
        refs.push({
          name: `${row.step_name} - Decision Sheet${dsUrls.length > 1 ? ` ${idx + 1}` : ''}`,
          url
        });
      });
    }
    
    if (refs.length > 0) {
      // Key by step_external_id for unique identification
      map[row.step_external_id] = refs;
      console.log(`[fetchReferences] Mapped ${refs.length} refs for step_external_id: ${row.step_external_id}, step_name: ${row.step_name}`);
    }
  }
  
  return map;
}
