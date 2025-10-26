import { supabase } from "@/integrations/supabase/client";

export type StepRef = { name: string; url: string };
export type RefMap = Record<string, StepRef[]>; // step_external_id -> refs[]

/**
 * Fetch all references (documents) for a service from MDS data.
 * Returns a map of step_external_id -> array of { name, url }
 */
export async function fetchReferencesForService(serviceKey: string): Promise<RefMap> {
  // Query mds_data table for this service and extract URLs
  const { data, error } = await supabase
    .from("mds_data")
    .select("step_external_id, step_name, document_urls, document_name")
    .eq("service_external_id", serviceKey);

  if (error || !data) {
    console.error("Error fetching MDS references:", error);
    return {};
  }

  const map: RefMap = {};
  
  for (const row of data) {
    if (!row?.step_external_id) continue;
    
    const refs: StepRef[] = [];
    
    // Use document_name (Column G: SOP/Decision Sheet Name) as the link text
    const documentTitle = row.document_name || row.step_name;
    
    // Parse document URLs (can be comma-separated)
    if (row.document_urls) {
      const urls = row.document_urls.split(',').map(u => u.trim()).filter(Boolean);
      urls.forEach((url, idx) => {
        refs.push({
          name: urls.length > 1 ? `${documentTitle} (${idx + 1})` : documentTitle,
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
