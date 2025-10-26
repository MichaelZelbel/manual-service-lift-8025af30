// /src/components/DownloadForCamundaButton.jsx
import React, { useState } from "react";
import { generateAndDownloadBundle } from "@/src/actions/generateForCamunda.js";
import { loadFormTemplates } from "@/src/utils/loadFormTemplates.js";

export default function DownloadForCamundaButton({ serviceName, bpmnModeler }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onClick() {
    if (!bpmnModeler) { setError("Modeler not ready."); return; }
    setBusy(true); setError("");
    try {
      const templates = await loadFormTemplates();
      await generateAndDownloadBundle({ serviceName, bpmnModeler, templates });
    } catch (e) {
      console.error(e);
      setError(e?.message || "Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onClick}
        disabled={busy}
        className="px-4 py-2 rounded-lg shadow text-white bg-indigo-600 disabled:opacity-60"
        title="Generate enriched BPMN + forms and download ZIP"
      >
        {busy ? "Generating…" : "Download for Camunda"}
      </button>
      {error ? <span className="text-red-500 text-sm">{error}</span> : null}
    </div>
  );
}
