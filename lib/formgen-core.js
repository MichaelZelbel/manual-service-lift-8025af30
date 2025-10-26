// /lib/formgen-core.js
// Core: enrich BPMN with FEEL + form bindings and generate Camunda forms + manifest + ZIP.
// - Plain-text placeholders only (no braces, no IDs).
// - Cascading XOR gateways -> nested dropdowns (nextTask, nextTask_2, ...).
// - OR -> flat checkbox group; AND -> no chooser.

import JSZip from "jszip";

/**
 * @typedef {Object} GenerateOptions
 * @property {string} serviceName
 * @property {any}    bpmnModeler
 * @property {{ firstStep: object, nextStep: object }} templates
 * @property {Date}  [now]
 */

/**
 * @typedef {Object} GeneratedBundle
 * @property {string} updatedBpmnXml
 * @property {Array<{nodeId:string,name:string,filename:string,formId:string,json:object}>} forms
 * @property {object} manifest
 * @property {Uint8Array} zipBinary
 */

export async function generateBundle(opts) {
  const { serviceName, bpmnModeler, templates, now = new Date(), resolveDescriptions } = opts;

  if (!bpmnModeler) throw new Error("generateBundle: bpmnModeler is required");
  if (!templates?.firstStep || !templates?.nextStep) {
    throw new Error("generateBundle: templates.firstStep and templates.nextStep are required");
  }

  const elementRegistry = bpmnModeler.get("elementRegistry");
  const modeling        = bpmnModeler.get("modeling");
  const moddle          = bpmnModeler.get("moddle");

  const forms = [];
  const ts = isoCompact(now);

  // Gather StartEvents + UserTasks robustly
  const allEls = elementRegistry.getAll();
  const nodes = allEls.filter((el) => {
    const t = el?.businessObject?.$type || el?.type || "";
    return t === "bpmn:StartEvent" || t === "bpmn:UserTask" || t === "bpmn:CallActivity";
  });

  for (const node of nodes) {
    const isStart = node.type === "bpmn:StartEvent" || node.businessObject?.$type === "bpmn:StartEvent";
    const template = deepClone(isStart ? templates.firstStep : templates.nextStep);

    // First gateway immediately after this node (if any)
    const nextGw = firstGatewayAfter(node);
    const kind   = nextGw ? gatewayType(nextGw) : null;

    // Build chooser UI
    const chooserPack = nextGw
      ? buildChooserForGateway(nextGw, kind, elementRegistry)
      : { components: null, options: [] };

    // Insert/remove chooser where plain token "NextTask(s)Placeholder" appears
    applyChooserPlaceholder(template, chooserPack.components);

    const stepName        = displayName(node);

    // Resolve description and references via external callback (if provided)
    let stepDescription = await getStepDescriptionFallback(node);
    let refs = [];
    try {
      if (typeof resolveDescriptions === "function") {
        const res = await resolveDescriptions(node);
        if (res && typeof res.stepDescription === "string" && res.stepDescription.trim()) {
          stepDescription = res.stepDescription.trim();
        }
        if (res && Array.isArray(res.references)) {
          refs = res.references;
        }
      }
    } catch (e) {
      console.error("[formgen] resolveDescriptions failed", e);
    }

    const nextTaskText    = buildNextTaskText(kind || "AND", chooserPack.options);

    const chooserExists =
      Array.isArray(chooserPack.components) && chooserPack.components.length > 0;

    // Replace plain-text placeholders anywhere
    replacePlaceholdersInForm(
      template,
      { serviceName, stepName, stepDescription, nextTaskText },
      { forceBlankNextTask: chooserExists }
    );

    // Replace ReferencesPlaceholder with proper HTML list of links
    applyReferencesPlaceholder(template, refs);

    // Form id + filename
    const baseName = isStart
      ? "000-start"
      : `${zeroPadOrder(node)}-${slug(stepName) || node.id}`;
    const formId = `${baseName}-${ts}`;

    ensureSchemaV4(template);
    template.id = formId;

    // Attach form binding
    attachFormDefinition(node, formId, moddle, modeling);

    // FEEL: write conditions (recursive for XOR cascades)
    if (nextGw) {
      enrichGatewayConditionsRecursive(nextGw, elementRegistry, moddle, modeling, 1);
    }

    forms.push({
      nodeId: node.id,
      name: stepName,
      filename: `${baseName}.form`,
      formId,
      json: template,
    });
  }

  const { xml: updatedBpmnXml } = await bpmnModeler.saveXML({ format: true });

  const manifest = {
    service: serviceName,
    generatedAt: now.toISOString(),
    forms: forms.map(({ nodeId, name, filename, formId }) => ({
      nodeId, name, filename, formId
    })),
  };

  const zip = new JSZip();
  zip.file("manual-service.bpmn", updatedBpmnXml);
  for (const f of forms) zip.file(f.filename, JSON.stringify(f.json, null, 2));
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  const zipBinary = await zip.generateAsync({ type: "uint8array" });

  return { updatedBpmnXml, forms, manifest, zipBinary };
}

/* ───────────────────────── BPMN graph helpers ───────────────────────── */

function firstGatewayAfter(node) {
  const outgoing = (node.outgoing || []).filter((sf) => sf && sf.target);
  for (const sf of outgoing) {
    const t = sf.target;
    const type = t?.businessObject?.$type || t?.type || "";
    if (type.includes("Gateway")) return t;
  }
  return null;
}

function gatewayType(g) {
  const t = g?.businessObject?.$type || g?.type || "";
  if (t.endsWith("ExclusiveGateway"))  return "XOR";
  if (t.endsWith("InclusiveGateway"))  return "OR";
  if (t.endsWith("ParallelGateway"))   return "AND";
  return null;
}

function displayName(el) {
  return el?.businessObject?.name || el?.id || "";
}

/* For OR (flat) we still need all leaf user tasks reachable from any nested gateways */
function collectUserTasksFromGatewayTarget(target, registry, seen = new Set()) {
  if (!target || seen.has(target.id)) return [];
  seen.add(target.id);

  const type = target.businessObject?.$type || target.type || "";
  if (type === "bpmn:UserTask" || type === "bpmn:CallActivity") return [target];
  if (type.includes("Gateway")) {
    let result = [];
    for (const sf of target.outgoing || []) {
      if (sf.target) result = result.concat(
        collectUserTasksFromGatewayTarget(sf.target, registry, seen)
      );
    }
    return result;
  }
  return [];
}

/* ─────────────── Cascading XOR chooser + recursive FEEL ─────────────── */

function varKeyForLevel(level) {
  return level === 1 ? "nextTask" : `nextTask_${level}`;
}

/* Build nested dropdowns for XOR cascades */
function buildCascadingChooser(gateway, registry, level = 1) {
  const key   = varKeyForLevel(level);
  const label = displayName(gateway) || "Next step";

  const outs    = gateway.outgoing || [];
  const targets = outs.map(sf => sf.target).filter(Boolean);

  // options include BOTH tasks and gateways (value = element id)
  const values = targets.map(t => ({
    label: displayName(t),
    value: t.id,
    _type: t.businessObject?.$type || t.type || ""
  }));

  const components = [{
    type: "select",
    key,
    label,
    validate: { required: true },
    values: values.map(v => ({ label: v.label, value: v.value }))
  }];

  // if option is a gateway → add conditional nested chooser
  for (const v of values) {
    if ((v._type || "").includes("Gateway")) {
      const gw = targets.find(t => t.id === v.value);
      const child = buildCascadingChooser(gw, registry, level + 1);
      components.push({
        type: "group",
        label: displayName(gw) || "Next step",
        conditional: { when: key, eq: v.value, show: true },
        components: child.components
      });
    }
  }

  // leaf tasks at this immediate level (for plain-text summary if needed)
  const options = values
    .filter(v => !(v._type || "").includes("Gateway"))
    .map(v => ({ label: v.label, value: v.value }));

  return { components, options };
}

function enrichGatewayConditionsRecursive(gateway, registry, moddle, modeling, level = 1) {
  const outs = gateway.outgoing || [];
  const kind = gatewayType(gateway);
  const key  = varKeyForLevel(level);

  if (kind !== "XOR") {
    // keep existing behavior for non-XOR (flat)
    enrichGatewayConditions(gateway, kind, registry, moddle, modeling);
    return;
  }

  // Default flow for XOR (no condition) → pick last for determinism
  let defaultFlow = outs.length ? outs[outs.length - 1] : null;
  if (defaultFlow) modeling.updateProperties(gateway, { default: defaultFlow });

  for (const sf of outs) {
    const tgt = sf.target;
    const t   = tgt?.businessObject?.$type || tgt?.type || "";

    if (defaultFlow && sf === defaultFlow) {
      modeling.updateProperties(sf, { conditionExpression: null });
    } else {
      const value = tgt?.id || "";
      const expr  = `= ${key} = "${value}"`;
      const ce    = moddle.create("bpmn:FormalExpression", { body: expr, language: "feel" });
      modeling.updateProperties(sf, { conditionExpression: ce });
    }

    if (t.includes("Gateway")) {
      enrichGatewayConditionsRecursive(tgt, registry, moddle, modeling, level + 1);
    }
  }
}

/* Fallback for OR/AND at level 1 (original flat logic) */
function buildChooserForGateway(gateway, kind, registry) {
  if (kind === "XOR") {
    return buildCascadingChooser(gateway, registry, 1);
  }

  const outs = gateway.outgoing || [];
  const options = outs
    .flatMap(sf => collectUserTasksFromGatewayTarget(sf.target, registry))
    .map(tgt => ({ label: displayName(tgt), value: tgt.id }));

  if (kind === "OR") {
    return {
      options,
      components: [{
        type: "checkbox-group",
        key: "nextTasks",
        label: displayName(gateway) || "Select next task(s)",
        validate: { required: true },
        values: options.map(o => ({ label: o.label, value: o.value }))
      }]
    };
  }

  // AND / unknown
  return { options: [], components: null };
}

/* Keep for non-XOR flat mode */
function enrichGatewayConditions(gateway, kind, registry, moddle, modeling) {
  const outs = gateway.outgoing || [];

  if (kind === "AND") {
    outs.forEach(sf => modeling.updateProperties(sf, { conditionExpression: null }));
    return;
  }

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
    const tgt = sf.target;
    const value = tgt?.id || "";
    const expr =
      kind === "XOR"
        ? `= nextTask = "${value}"`
        : `= list contains(nextTasks, "${value}")`;
    const ce = moddle.create("bpmn:FormalExpression", { body: expr, language: "feel" });
    modeling.updateProperties(sf, { conditionExpression: ce });
  }
}

/* ─────────────── Placeholder replacement & chooser swap ─────────────── */

function replacePlaceholdersInForm(
  formJson,
  context,
  { forceBlankNextTask = false } = {}
) {
  // case-insensitive whole-word replace
  const swapWordCI = (s, word, val) =>
    s.replace(new RegExp(`\\b${word}\\b`, "gi"), val);

  const swap = (s = "") => {
    const nextTxt = forceBlankNextTask ? "" : (context.nextTaskText || "");
    let out = String(s);

    out = swapWordCI(out, "ManualServiceNamePlaceholder",   context.serviceName ?? "");
    out = swapWordCI(out, "ProcessStepPlaceholder",         context.stepName ?? "");
    out = swapWordCI(out, "ProcessDescriptionPlaceholder",  context.stepDescription ?? "");
    out = swapWordCI(out, "NextTaskPlaceholder",            nextTxt);
    out = swapWordCI(out, "NextTasksPlaceholder",           nextTxt);

    return out;
  };

  function walk(node) {
    if (!node || typeof node !== "object") return;

    // Replace on ALL string properties
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === "string") node[k] = swap(v);
    }

    // values[].label
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

/* Find plain text "NextTask(s)Placeholder" anywhere and replace/remove */
function applyChooserPlaceholder(formJson, chooserComponentsOrNull) {
  if (!formJson || !Array.isArray(formJson.components)) return;

  let replaced = false;

  const isNextToken = (s) => {
    if (typeof s !== "string") return false;
    const t = s.trim();
    return /\bNextTaskPlaceholder\b/i.test(t) || /\bNextTasksPlaceholder\b/i.test(t);
  };

  function walk(list, parent) {
    for (let i = 0; i < list.length; i++) {
      const node = list[i];

      // Lone text token
      if (node?.type === "text" && isNextToken(node.text)) {
        if (!chooserComponentsOrNull) {
          list.splice(i, 1); // remove token
        } else {
          list[i] = { type: "group", label: "Next step(s)", components: chooserComponentsOrNull };
        }
        replaced = true;
        return;
      }

      // Container that *contains* the token → treat as chooser section
      const isContainer = node && Array.isArray(node.components)
        && ['group','panel','fieldset','container','section','accordion','tab','tabs','card']
          .includes((node.type || '').toLowerCase());

      if (isContainer) {
        const idxChildText = node.components.findIndex(
          (c) => c?.type === "text" && isNextToken(c.text)
        );
        if (idxChildText !== -1) {
          if (!chooserComponentsOrNull) {
            list.splice(i, 1); // remove whole container
          } else {
            node.type = "group";
            node.label = node.label || "Next step(s)";
            node.components = chooserComponentsOrNull;
          }
          replaced = true;
          return;
        }
        // Recurse
        walk(node.components, node);
        if (replaced) return;
      }

      // Recurse for any nested structure
      if (Array.isArray(node?.components)) {
        walk(node.components, node);
        if (replaced) return;
      }
    }
  }

  walk(formJson.components, null);
}

// Replace "ReferencesPlaceholder" token with HTML links list
function applyReferencesPlaceholder(formJson, refs) {
  if (!formJson || !Array.isArray(formJson.components)) return;

  const isRefToken = (s) => typeof s === 'string' && /\bReferencesPlaceholder\b/i.test(s.trim());

  const escape = (str = '') => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const html = Array.isArray(refs) && refs.length
    ? `<ul>` + refs.map(r => {
        const name = escape(r?.name || r?.url || 'Document');
        const url  = escape(r?.url || '#');
        return `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a></li>`;
      }).join('') + `</ul>`
    : '';

  let replaced = false;

  function walk(list) {
    for (let i = 0; i < list.length; i++) {
      const node = list[i];

      // Replace standalone token
      if (node?.type === 'text' && isRefToken(node.text)) {
        if (!html) {
          list.splice(i, 1);
        } else {
          list[i] = { type: 'text', text: html };
        }
        replaced = true;
        return;
      }

      // Container that contains token
      if (node && Array.isArray(node.components)) {
        const idx = node.components.findIndex(c => c?.type === 'text' && isRefToken(c.text));
        if (idx !== -1) {
          if (!html) {
            list.splice(i, 1);
          } else {
            node.type = 'group';
            node.label = node.label || 'References';
            node.components = [{ type: 'text', text: html }];
          }
          replaced = true;
          return;
        }
        walk(node.components);
        if (replaced) return;
      }
    }
  }

  walk(formJson.components);
}

/* ───────────────────────────── Misc utilities ─────────────────────────── */

function ensureSchemaV4(form) {
  if (!form.schemaVersion) form.schemaVersion = 4;
  if (!form.type) form.type = "form";
}

function attachFormDefinition(node, formId, moddle, modeling) {
  const bo = node.businessObject;
  const ext = bo.extensionElements || moddle.create("bpmn:ExtensionElements");
  const values = (ext.values || []).filter(v => v.$type !== "zeebe:FormDefinition");

  const formDef = moddle.create("zeebe:FormDefinition", {
    formId,
    binding: "deployment"
  });

  // keep zeebe:UserTask for Camunda modeler compatibility on user tasks
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
  const names = options.map(o => o.label);
  if (kind === "AND") return names.join(", ");
  if (kind === "OR")  return names.join(" • ");
  return names.join(" / ");
}

async function getStepDescriptionFallback(/* node */) {
  return "";
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function slug(s) {
  return (s || "")
    .toString()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/-+/g, "-");
}

function isoCompact(d) {
  const iso = d.toISOString(); // 2025-10-23T22:45:12.345Z
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function zeroPadOrder(node) {
  const y = node.di?.bounds?.y ?? 0;
  const x = node.di?.bounds?.x ?? 0;
  const ord = (y * 1000 + x) | 0;
  return String(Math.max(0, Math.min(999, ord))).padStart(3, "0");
}
