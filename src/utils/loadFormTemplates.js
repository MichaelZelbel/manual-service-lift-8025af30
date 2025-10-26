// /src/utils/loadFormTemplates.js
import { supabase } from "@/integrations/supabase/client";

let cache = null;

export async function loadFormTemplates() {
  if (cache) return cache;

  const startP = supabase.storage.from("form_templates").download("start-node.form");
  const taskP  = supabase.storage.from("form_templates").download("task-node.form");

  const [{ data: startBlob, error: e1 }, { data: taskBlob, error: e2 }] = await Promise.all([startP, taskP]);

  if (e1) throw new Error(`Failed to load start-node.form: ${e1.message}`);
  if (e2) throw new Error(`Failed to load task-node.form: ${e2.message}`);

  const startText = await startBlob.text();
  const taskText  = await taskBlob.text();

  const firstStep = JSON.parse(startText); // start template
  const nextStep  = JSON.parse(taskText);  // user task template

  cache = { firstStep, nextStep };
  return cache;
}
