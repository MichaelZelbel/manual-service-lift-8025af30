// /src/utils/loadFormTemplates.js
import { supabase } from "@/integrations/supabase/client";

export async function loadFormTemplates() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  const fetchSigned = async (templateName) => {
    const url = `${supabaseUrl}/functions/v1/download-template?template_name=${encodeURIComponent(templateName)}&t=${Date.now()}`;
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to get signed URL for ${templateName}`);
    const json = await res.json();
    if (!json?.signed_url) throw new Error(`No signed URL returned for ${templateName}`);
    const fileRes = await fetch(json.signed_url, { cache: 'no-store' });
    if (!fileRes.ok) throw new Error(`Failed to download ${templateName}`);
    return JSON.parse(await fileRes.text());
  };

  const [firstStep, nextStep] = await Promise.all([
    fetchSigned('START_NODE'),
    fetchSigned('TASK_NODE'),
  ]);

  return { firstStep, nextStep };
}
