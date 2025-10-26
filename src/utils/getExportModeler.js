// /src/utils/getExportModeler.js
// Creates or reuses a headless bpmn-js Modeler instance for export.

import BpmnJS from "bpmn-js/lib/Modeler";

let headlessModeler = null;

/**
 * Returns a bpmn-js Modeler instance loaded with the Manual Service BPMN XML.
 * If a visible editor modeler exists and is exposed globally, reuse it.
 *
 * @param {string} manualServiceBpmnXml
 * @returns {Promise<any>} modeler
 */
export async function getExportModeler(manualServiceBpmnXml) {
  // Always use a headless modeler for exports to guarantee we load the
  // exact BPMN XML passed in, avoiding accidental reuse of any visible editor.
  // (Previously reused window.__ACTIVE_BPMN_MODELER__, which could point to a
  // different diagram and miss tasks.)

  if (!headlessModeler) {
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-99999px";
    container.style.top = "-99999px";
    container.style.width = "1px";
    container.style.height = "1px";
    container.setAttribute("aria-hidden", "true");
    document.body.appendChild(container);

    headlessModeler = new BpmnJS({ container });
  }

  if (!manualServiceBpmnXml) {
    throw new Error("Manual Service BPMN XML is empty or undefined.");
  }

  await headlessModeler.importXML(manualServiceBpmnXml);
  return headlessModeler;
}
