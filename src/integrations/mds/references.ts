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
    .select("step_external_id, step_name, sop_urls, decision_sheet_urls, sop_titles, decision_sheet_titles")
    .eq("service_external_id", serviceKey);

  if (error || !data) {
    console.error("Error fetching MDS references:", error);
    return {};
  }

  const map: RefMap = {};
  
  for (const row of data) {
    if (!row?.step_external_id) continue;
    
    const refs: StepRef[] = [];
    
    // Parse SOP URLs and titles
    if (row.sop_urls) {
      const sopUrls = row.sop_urls.split(',').map(u => u.trim()).filter(Boolean);
      const sopTitles = row.sop_titles ? row.sop_titles.split(',').map(t => t.trim()).filter(Boolean) : [];
      
      sopUrls.forEach((url, idx) => {
        const title = sopTitles[idx] || row.step_name;
        refs.push({
          name: sopUrls.length > 1 && !sopTitles[idx] ? `${title} (${idx + 1})` : title,
          url
        });
      });
    }
    
    // Parse Decision Sheet URLs and titles
    if (row.decision_sheet_urls) {
      const dsUrls = row.decision_sheet_urls.split(',').map(u => u.trim()).filter(Boolean);
      const dsTitles = row.decision_sheet_titles ? row.decision_sheet_titles.split(',').map(t => t.trim()).filter(Boolean) : [];
      
      dsUrls.forEach((url, idx) => {
        const title = dsTitles[idx] || row.step_name;
        refs.push({
          name: dsUrls.length > 1 && !dsTitles[idx] ? `${title} (${idx + 1})` : title,
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
