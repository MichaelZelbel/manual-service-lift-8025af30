// /src/utils/loadFormTemplates.js
import { supabase } from "@/integrations/supabase/client";

export async function loadFormTemplates() {
  const [startRes, taskRes] = await Promise.all([
    supabase.storage.from("form_templates").download("start-node.form"),
    supabase.storage.from("form_templates").download("task-node.form"),
  ]);

  if (startRes.error) throw new Error(`Failed to load start-node.form: ${startRes.error.message}`);
  if (taskRes.error) throw new Error(`Failed to load task-node.form: ${taskRes.error.message}`);

  const firstStep = JSON.parse(await startRes.data.text());
  const nextStep = JSON.parse(await taskRes.data.text());

  return { firstStep, nextStep };
}
