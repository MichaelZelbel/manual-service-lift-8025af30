// /src/utils/loadFormTemplates.js
import { supabase } from "@/integrations/supabase/client";

export async function loadFormTemplates() {
  const [firstStep, nextStep] = await Promise.all([
    fetchTemplate("START_NODE", "start-node.form"),
    fetchTemplate("TASK_NODE",  "task-node.form"),
  ]);

  return { firstStep, nextStep };
}

/**
 * Try (A) edge function signed URL, then (B) direct storage download (public buckets).
 * @param {"START_NODE"|"TASK_NODE"} logicalName
 * @param {string} storagePath
 */
async function fetchTemplate(logicalName, storagePath) {
  // A) Try your Edge Function first
  const signed = await tryFetchViaSignedUrl(logicalName);
  if (signed.ok) return signed.json;

  // B) Fallback: direct Supabase Storage download (works if bucket is public or RLS allows it)
  const direct = await tryFetchViaStorage(storagePath);
  if (direct.ok) return direct.json;

  // Both failed
  const errs = [signed.error, direct.error].filter(Boolean).join(" | ");
  throw new Error(`Failed to load template ${logicalName}: ${errs || "unknown error"}`);
}

async function tryFetchViaSignedUrl(templateName) {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!supabaseUrl) throw new Error("VITE_SUPABASE_URL not set");

    const url = `${supabaseUrl}/functions/v1/download-template?template_name=${encodeURIComponent(templateName)}&t=${Date.now()}`;
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) throw new Error(`Edge function HTTP ${res.status}`);

    const json = await res.json();
    const signedUrl = json?.signed_url;
    if (!signedUrl) throw new Error("Edge function response missing signed_url");

    const fileRes = await fetch(signedUrl, { cache: "no-store" });
    if (!fileRes.ok) throw new Error(`Signed URL fetch HTTP ${fileRes.status}`);

    const text = await fileRes.text();
    const parsed = safeParseJson(text);
    if (!parsed.ok) throw new Error(`Invalid JSON: ${parsed.error}`);

    return { ok: true, json: parsed.value };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function tryFetchViaStorage(storagePath) {
  try {
    const { data, error } = await supabase.storage
      .from("form_templates")
      .download(storagePath);

    if (error) throw new Error(error.message || "Storage download failed");
    const text = await data.text();

    const parsed = safeParseJson(text);
    if (!parsed.ok) throw new Error(`Invalid JSON: ${parsed.error}`);

    return { ok: true, json: parsed.value };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function safeParseJson(text) {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object") return { ok: true, value };
    return { ok: false, error: "JSON is not an object" };
  } catch (e) {
    return { ok: false, error: e?.message || "JSON parse error" };
  }
}
