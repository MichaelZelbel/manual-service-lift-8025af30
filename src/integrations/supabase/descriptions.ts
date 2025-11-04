import { supabase } from "@/integrations/supabase/client";

export type StepSummaryUpsert = {
  serviceKey: string;
  nodeId: string | null;
  stepDescription?: string;
  serviceDescription?: string;
};

export async function fetchStepDescription(serviceKey: string, nodeId: string): Promise<string> {
  const { data, error } = await supabase
    .from("step_descriptions")
    .select("step_description")
    .eq("service_key", serviceKey)
    .eq("node_id", nodeId)
    .maybeSingle();
  
  if (error) {
    console.error("Error fetching step description:", error);
    return "";
  }
  
  return (data?.step_description || "").trim();
}

export async function fetchServiceDescription(serviceKey: string): Promise<string> {
  const { data, error } = await supabase
    .from("step_descriptions")
    .select("service_description")
    .eq("service_key", serviceKey)
    .is("node_id", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (error) {
    console.error("Error fetching service description:", error);
    return "";
  }
  
  return (data?.service_description || "").trim();
}

export async function upsertStepSummaries(rows: StepSummaryUpsert[]) {
  const payload = rows.map(r => ({
    service_key: r.serviceKey,
    node_id: r.nodeId ?? null,
    step_description: r.stepDescription ?? null,
    service_description: r.serviceDescription ?? null,
    updated_at: new Date().toISOString()
  }));
  
  const { error } = await supabase
    .from("step_descriptions")
    .upsert(payload, { onConflict: "service_key,node_id" });
  
  if (error) throw error;
}
