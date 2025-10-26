// /lib/formgen-core.js
// Plain JavaScript core to (a) enrich BPMN with FEEL + form bindings
// and (b) generate Camunda Tasklist forms + a ZIP bundle.
//
// Dependencies: jszip
// Assumes you already have a bpmn-js Modeler instance available.

import JSZip from "jszip";

/**
 * @typedef {Object} GenerateOptions
 * @property {string} serviceName
 * @property {any} bpmnModeler           // bpmn-js Modeler instance
 * @property {{ firstStep: object, nextStep: object }} templates
 * @property {Date} [now]
 */

/**
 * @typedef {Object} GeneratedBundle
 * @property {string} updatedBpmnXml
 * @property {Array<{nodeId:string,name:string,filename:string,formId:string,json:object}>} forms
 * @property {object} manifest
 * @property {Uint8Array} zipBinary
 */

/**
 * Generate enriched BPMN + forms + ZIP (all in-memory).
 * - Attaches zeebe:formDefinition to Start/User tasks
 * - Injects FEEL on sequence flows for XOR / OR gateways
 * - Builds forms from Supabase templates and replaces placeholders
 * - Packages everything into a ZIP
 *
 * @param {GenerateOptions} opts
 * @returns {Promise<GeneratedBundle>}
 */
export async function generateBundle(opts) {
  const { serviceName, bpmnModeler, templates, now = new Date() } = opts;

  if (!bpmnModeler) throw new Error("generateBundle: bpmnModeler is required");
  if (!templates?.firstStep || !templates?.nextStep) {
    throw new Error("generateBundle: templates.firstStep and templates.nextStep are required");
  }

  const elementRegistry = bpmnModeler.get("elementRegistry");
  const modeling        = bpmnModeler.get("modeling");
  const moddle          = bpmnModeler.get("moddle");

  const forms = [];
  const ts = isoCompact(now); // e.g. 20251023T224512Z

  // Gather StartEvents and Task-like nodes (UserTask, ManualTask, generic Task)
  const allEls = elementRegistry.getAll();
  const nodes = allEls.filter((el) => {
    const t = el?.businessObject?.$type || el?.type || "";
    return t === "bpmn:StartEvent" || t === "bpmn:UserTask" || t === "bpmn:ManualTask" || t === "bpmn:Task";
  });


  for (const node of nodes) {
    const nodeType = node?.businessObject?.$type || node?.type || "";
    const isStart = nodeType === "bpmn:StartEvent";
    const template = deepClone(isStart ? templates.firstStep : templates.nextStep);

    // Detect the first gateway after this node (if any)
    const nextGw = firstGatewayAfter(node);
    const kind = nextGw ? gatewayType(nextGw) : null;

    // Build chooser components and options for placeholder text
    const chooserPack = nextGw
      ? buildChooserForGateway(nextGw, kind, elementRegistry)
      : { components: null, options: [] };

    // Replace or remove the placeholder group anywhere it appears (robust, recursive)
    applyChooserPlaceholder(template, chooserPack.components);

    // Build placeholder context
    const stepName = displayName(node);
    const stepDescription = await getStepDescriptionFallback(node); // hook for SOP/MDS
    const nextTaskText = buildNextTaskText(kind || "AND", chooserPack.options);

    // If a chooser is injected, blank any stray NextTask placeholders that might exist elsewhere
    const chooserExists =
      Array.isArray(chooserPack.components) && chooserPack.components.length > 0;

    replacePlaceholdersInForm(
      template,
      {
        serviceName,
        stepName,
        stepDescription,
        nextTaskText,
      },
      { forceBlankNextTask: chooserExists }
    );

    // Form ID and filename
    const baseName = isStart
      ? "000-start"
      : `${zeroPadOrder(node)}-${slug(stepName) || node.id}`;
    const formId = `${baseName}-${ts}`;
    ensureSchemaV4(template);
    template.id = formId;

    // Attach form definition to BPMN node
    attachFormDefinition(node, formId, moddle, modeling);

    // Enrich FEEL conditions for the detected gateway
    if (nextGw) {
      enrichGatewayConditions(nextGw, kind, elementRegistry, moddle, modeling);
    }

    forms.push({
      nodeId: node.id,
      name: stepName,
      filename: `${baseName}.form`,
      formId,
      json: template,
    });
  }

  // Export enriched BPMN XML
  const { xml: updatedBpmnXml } = await bpmnModeler.saveXML({ format: true });

  // Manifest
  const manifest = {
    service: serviceName,
    generatedAt: now.toISOString(),
    forms: forms.map(({ nodeId, name, filename, formId }) => ({
      nodeId,
      name,
      filename,
      formId,
    })),
  };

  // ZIP
  const zip = new JSZip();
  zip.file("manual-service.bpmn", updatedBpmnXml);
  for (const f of forms) {
    zip.file(f.filename, JSON.stringify(f.json, null, 2));
  }
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  const zipBinary = await zip.generateAsync({ type: "uint8array" });

  return { updatedBpmnXml, forms, manifest, zipBinary };
}

/* ------------------------------ BPMN helpers ------------------------------ */

function firstGatewayAfter(node) {
  const outgoing = (node.outgoing || []).filter((sf) => sf && sf.target);
  if (!outgoing.length) return null;

  // Prefer the first gateway target, if any
  for (const sf of outgoing) {
    const t = sf.target;
    const type = t.type || t.businessObject?.$type || "";
    if (type.startsWith("bpmn:") && type.includes("Gateway")) return t;
  }
  return null;
}

function gatewayType(g) {
  const t = g.type || g.businessObject?.$type || "";
  if (t.endsWith("ExclusiveGateway")) return "XOR";
  if (t.endsWith("InclusiveGateway")) return "OR";
  if (t.endsWith("ParallelGateway")) return "AND";
  return null;
}

function displayName(el) {
  return el.businessObject?.name || el.id || "";
}

function resolveToUserTask(el /*, registry */) {
  if (!el) return null;
  const t = el.businessObject?.$type || el.type;
  if (t === "bpmn:UserTask" || t === "bpmn:ManualTask" || t === "bpmn:Task") return el;
  // Prototype assumption: gateway connects directly to task-like nodes.
  return null;
}

/**
 * Build chooser components and option list for a gateway.
 * Returns { components, options }.
 */
function buildChooserForGateway(gateway, kind, registry) {
  const outs = gateway.outgoing || [];
  const options = outs
    .map((sf) => {
      const tgt = resolveToUserTask(sf.target, registry);
      return tgt ? { label: displayName(tgt), value: tgt.id } : null;
    })
    .filter(Boolean);

  if (kind === "XOR") {
    return {
      options,
      components: [
        {
          type: "select",
          key: "nextTask",
          label: "Choose the next task",
          validate: { required: true },
          values: options.map((o) => ({ label: o.label, value: o.value })),
        },
      ],
    };
  }
  if (kind === "OR") {
    return {
      options,
      components: [
        {
          type: "checkbox-group",
          key: "nextTasks",
          label: "Select all next tasks that apply",
          validate: { required: true },
          values: options.map((o) => ({ label: o.label, value: o.value })),
        },
      ],
    };
  }
  // AND or no gateway: no chooser
  return { options: [], components: null };
}

/**
 * Robust, recursive placeholder swapper. Finds:
 * - a group with id/key "NextTaskChooserPlaceholder", OR
 * - any group containing a text component whose text includes the token, OR
 * - a lone text component with the token,
 * and replaces the group (or text) with the chooser, or removes it entirely if no chooser is needed.
 */
function applyChooserPlaceholder(formJson, chooserComponentsOrNull) {
  if (!formJson || !Array.isArray(formJson.components)) return;

  let replaced = false;

  const matchesToken = (s) => {
    if (typeof s !== "string") return false;
    const t = s.trim();
    return (
      t.includes("{{NextTaskPlaceholder}}") ||
      t.includes("{{NextTasksPlaceholder}}") ||
      /\bNextTaskPlaceholder\b/.test(t) ||
      /\bNextTasksPlaceholder\b/.test(t)
    );
  }

  function walk(list, parent) {
    for (let i = 0; i < list.length; i++) {
      const node = list[i];

      const idMatch =
        node?.id === "NextTaskChooserPlaceholder" ||
        node?.key === "NextTaskChooserPlaceholder";

      const textNode = node?.type === "text" && matchesToken(node.text);
      const isGroup =
        node?.type === "group" ||
        node?.type === "panel" ||
        node?.type === "fieldset";

      // (A) Exact placeholder group by id/key
      if (idMatch) {
        if (!chooserComponentsOrNull) {
          list.splice(i, 1); // remove entire group
        } else {
          node.type = "group";
          node.label = node.label || "Next step(s)";
          node.components = chooserComponentsOrNull;
        }
        replaced = true;
        return;
      }

      // (B) A group that contains a text component with the token
      if (isGroup && Array.isArray(node.components)) {
        const idx = node.components.findIndex(
          (c) => c?.type === "text" && matchesToken(c.text)
        );
        if (idx !== -1) {
          if (!chooserComponentsOrNull) {
            const removeIndex = parent ? list.indexOf(node) : i;
            list.splice(removeIndex, 1);
          } else {
            node.type = "group";
            node.label = node.label || "Next step(s)";
            node.components = chooserComponentsOrNull;
          }
          replaced = true;
          return;
        }
      }

      // (C) Lone text token (no group) -> replace this text node with a proper group or remove it
      if (textNode) {
        if (!chooserComponentsOrNull) {
          list.splice(i, 1); // remove lone token if no chooser is required
        } else {
          list[i] = {
            type: "group",
            label: "Next step(s)",
            components: chooserComponentsOrNull,
          };
        }
        replaced = true;
        return;
      }

      // Recurse
      if (Array.isArray(node?.components)) {
        walk(node.components, node);
        if (replaced) return;
      }
    }
  }

  walk(formJson.components, null);
}

/**
 * Enrich sequence flows of a gateway with FEEL conditions.
 * - XOR: conditions on all non-default flows; one default with no condition
 * - OR:  conditions on all flows
 * - AND: no conditions
 */
function enrichGatewayConditions(gateway, kind, registry, moddle, modeling) {
  const outs = gateway.outgoing || [];

  if (kind === "AND") {
    outs.forEach((sf) => modeling.updateProperties(sf, { conditionExpression: null }));
    return;
  }

  // For XOR, choose one default (no condition). Pick the last flow deterministically.
  let defaultFlow = null;
  if (kind === "XOR" && outs.length) {
    defaultFlow = outs[outs.length - 1];
    modeling.updateProperties(gateway, { default: defaultFlow });
  }

  for (const sf of outs) {
    if (kind === "XOR" && sf === defaultFlow) {
      modeling.updateProperties(sf, { conditionExpression: null });
      continue;
    }
    const tgt = resolveToUserTask(sf.target, registry);
    const value = tgt ? tgt.id : "";

    const expr =
      kind === "XOR"
        ? `= nextTask = "${value}"`
        : `= list contains(nextTasks, "${value}")`;

    const ce = moddle.create("bpmn:FormalExpression", { body: expr, language: "feel" });
    modeling.updateProperties(sf, { conditionExpression: ce });
  }
}

/* --------------------------- Placeholder replacer -------------------------- */

/**
 * Replace known placeholders across any string field of the form JSON.
 * - Accepts both singular and plural, braced and unbraced "NextTask(s)Placeholder"
 * - Optional forceBlankNextTask makes NextTask placeholders blank if a chooser exists elsewhere
 */
function replacePlaceholdersInForm(
  formJson,
  context,
  { forceBlankNextTask = false } = {}
) {
  const swapNext = (s = "", nextText) =>
    String(s)
      .replaceAll("{{NextTaskPlaceholder}}", nextText)
      .replaceAll("{{NextTasksPlaceholder}}", nextText)
      .replace(/\bNextTaskPlaceholder\b/g, nextText)
      .replace(/\bNextTasksPlaceholder\b/g, nextText);

  const swap = (s = "") => {
    const nextTxt = forceBlankNextTask ? "" : context.nextTaskText || "";
    let out = String(s)
      .replaceAll(
        "{{ManualServiceNamePlaceholder}}",
        context.serviceName || ""
      )
      .replace(/\bManualServiceNamePlaceholder\b/g, context.serviceName || "")
      .replaceAll(
        "{{ProcessStepPlaceholder}}",
        context.stepName || ""
      )
      .replace(/\bProcessStepPlaceholder\b/g, context.stepName || "")
      .replaceAll(
        "{{ProcessDescriptionPlaceholder}}",
        context.stepDescription || ""
      )
      .replace(/\bProcessDescriptionPlaceholder\b/g, context.stepDescription || "");
    out = swapNext(out, nextTxt);
    return out;
  };

  function walk(node) {
    if (!node || typeof node !== "object") return;

    // Replace on ALL string properties
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === "string") node[k] = swap(v);
    }

    // Option labels inside values[]
    if (Array.isArray(node.values)) {
      node.values.forEach((opt) => {
        if (opt && typeof opt.label === "string") opt.label = swap(opt.label);
      });
    }

    // Recurse
    if (Array.isArray(node.components)) node.components.forEach(walk);
  }

  walk(formJson);
  return formJson;
}

/* ------------------------------- Misc utils ------------------------------- */

function ensureSchemaV4(form) {
  if (!form.schemaVersion) form.schemaVersion = 4;
  if (!form.type) form.type = "form";
}

function attachFormDefinition(node, formId, moddle, modeling) {
  const bo = node.businessObject;
  const existingExt = bo.extensionElements;
  const ext = existingExt || moddle.create("bpmn:ExtensionElements");

  // Remove duplicates
  const values = (ext.values || []).filter(
    (v) => v.$type !== "zeebe:FormDefinition"
  );

  const formDef = moddle.create("zeebe:FormDefinition", {
    formId,
    bindingType: "deployment",
  });

  // Always attach the FormDefinition; optional extra extension for UserTask only
  if (bo.$type === "bpmn:UserTask") {
    const userTaskExt = moddle.create("zeebe:UserTask", {});
    values.push(formDef, userTaskExt);
  } else {
    values.push(formDef);
  }

  ext.values = values;
  modeling.updateProperties(node, { extensionElements: ext });
}

function buildNextTaskText(kind, options) {
  if (!options || !options.length) return "";
  const names = options.map((o) => o.label);
  if (kind === "AND") return names.join(", ");
  if (kind === "OR") return names.join(" • ");
  return names.join(" / ");
}

async function getStepDescriptionFallback(/* node */) {
  // Hook for later: pull SOP-derived summary from your MDS.
  return "";
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function slug(s) {
  return (s || "")
    .toString()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/-+/g, "-");
}

function isoCompact(d) {
  // 2025-10-23T22:45:12.345Z -> 20251023T224512Z
  const iso = d.toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function zeroPadOrder(node) {
  // Simple deterministic order from DI coords (prototype-friendly)
  const y = node.di?.bounds?.y ?? 0;
  const x = node.di?.bounds?.x ?? 0;
  const ord = (y * 1000 + x) | 0;
  return String(Math.max(0, Math.min(999, ord))).padStart(3, "0");
}
