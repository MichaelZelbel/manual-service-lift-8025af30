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

  // Gather StartEvents + UserTasks robustly (exclude label elements)
  const allEls = elementRegistry.getAll();
  const nodes = allEls.filter((el) => {
    const t = el?.businessObject?.$type || el?.type || "";
    // Exclude label elements (they have type="label" and are visual only)
    if (t === "label" || el?.type === "label") return false;
    return t === "bpmn:StartEvent" || t === "bpmn:UserTask" || t === "bpmn:CallActivity";
  });

  for (const node of nodes) {
    const isStart = node.type === "bpmn:StartEvent" || node.businessObject?.$type === "bpmn:StartEvent";
    const template = deepClone(isStart ? templates.firstStep : templates.nextStep);

    // First gateway immediately after this node (if any)
    const nextGw = firstGatewayAfter(node);
    const kind   = nextGw ? gatewayType(nextGw) : null;
    
    console.log(`[formgen] Node ${node.id} (${isStart ? 'START' : 'TASK'}): gateway=${nextGw?.id || 'none'}, type=${kind || 'none'}, outgoing=${(node.outgoing || []).length}`);

    // Build chooser UI
    const chooserPack = nextGw
      ? buildChooserForGateway(nextGw, kind, elementRegistry)
      : { components: null, options: [] };
    
    console.log(`[formgen] Chooser for ${node.id}: components=${chooserPack.components?.length || 0}, options=${chooserPack.options?.length || 0}`);

    // Insert/remove chooser where plain token "NextTask(s)Placeholder" appears
    applyChooserPlaceholder(template, chooserPack.components);

    const stepName        = displayName(node);

    // Resolve description and references via external callback (if provided)
    let stepDescription = await getStepDescriptionFallback(node);
    let refs = [];
    try {
      if (typeof resolveDescriptions === "function") {
        console.log(`[formgen] Calling resolveDescriptions for node ${node.id}, isStart=${isStart}`);
        const res = await resolveDescriptions(node);
        console.log(`[formgen] resolveDescriptions returned:`, res);
        if (res && typeof res.stepDescription === "string" && res.stepDescription.trim()) {
          stepDescription = res.stepDescription.trim();
          console.log(`[formgen] Using resolved description: "${stepDescription.substring(0, 50)}..."`);
        } else {
          console.log(`[formgen] No valid description from resolveDescriptions, using fallback: "${stepDescription.substring(0, 50)}..."`);
        }
        if (res && Array.isArray(res.references)) {
          refs = res.references;
        }
      }
    } catch (e) {
      console.error("[formgen] resolveDescriptions failed", e);
    }

    const refsHtml       = buildReferencesHtml(refs);
    const nextTaskText    = buildNextTaskText(kind || "AND", chooserPack.options);

    const chooserExists =
      Array.isArray(chooserPack.components) && chooserPack.components.length > 0;

    // Replace plain-text placeholders anywhere
    replacePlaceholdersInForm(
      template,
      { serviceName, stepName, stepDescription, nextTaskText, refsHtml },
      { forceBlankNextTask: chooserExists }
    );

    // Replace ReferencesPlaceholder with proper HTML list of links (structural fallback)
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
  // Find the nearest reachable splitting gateway (outgoing count > 1)
  const queue = [];
  const visited = new Set();

  // Seed with immediate outgoing targets
  for (const sf of (node.outgoing || [])) {
    if (sf && sf.target) queue.push(sf.target);
  }

  while (queue.length) {
    const cur = queue.shift();
    if (!cur || visited.has(cur.id)) continue;
    visited.add(cur.id);

    const type = cur?.businessObject?.$type || cur?.type || "";
    if (type.includes("Gateway")) {
      const outs = (cur.outgoing || []).filter((f) => f && f.target);
      if (outs.length > 1) return cur; // first splitting gateway
      // Single-outgoing gateway (e.g., merge) — keep traversing
      for (const f of outs) if (f.target) queue.push(f.target);
      continue;
    }

    // Not a gateway — continue traversal
    for (const f of (cur.outgoing || [])) if (f.target) queue.push(f.target);
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

function safeName(el) {
  const n = el?.businessObject?.name;
  return (typeof n === 'string' && n.trim()) ? n.trim() : '';
}

function labelOf(el, fallback) {
  const n = safeName(el);
  return n || fallback; // never fall back to id
}

// Compatibility alias for older references
function displayName(el) {
  return labelOf(el, "");
}


/* For OR (flat) we still need all leaf user tasks reachable from any nested gateways */
function collectUserTasksFromGatewayTarget(target, registry, seen = new Set()) {
  if (!target || seen.has(target.id)) return [];
  seen.add(target.id);

  const type = target.businessObject?.$type || target.type || "";
  if (
  type === "bpmn:UserTask" ||
  type === "bpmn:CallActivity" ||
  type === "bpmn:SubProcess"
) return [target];


  
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
  const key   = level === 1 ? "nextTask" : `nextTask_${level}`;
  const label = labelOf(gateway, "Please choose");

  const outs    = gateway.outgoing || [];
  const targets = outs.map(sf => sf.target).filter(Boolean);

  const seen    = new Set();
  const choices = [];
  for (const t of targets) {
    const id = t?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const typ = t?.businessObject?.$type || t?.type || "";
    const fallback = typ.includes("Gateway") ? "Next decision" : "Next task";
    choices.push({ label: labelOf(t, fallback), value: id, _type: typ, _el: t });
  }

  // top-level select for THIS XOR level (single-select, no wrapper)
  const components = [{
    type: "select",
    key,
    label,
    validate: { required: true },
    values: choices.map(v => ({ label: v.label, value: v.value }))
  }];

  // for any gateway option: insert child chooser directly (no group box)
  for (const ch of choices) {
    if (!(ch._type || "").includes("Gateway")) continue;

    const childGw   = ch._el;
    const childKind = gatewayType(childGw);

    if (childKind === "XOR") {
      const child = buildCascadingChooser(childGw, registry, level + 1);
      for (const c of child.components) {
        c.conditional = { hide: `= ${key} != "${ch.value}"` };
        components.push(c);
      }
    } else if (childKind === "OR") {
      const orPack = buildOrChooser(childGw, registry);     // <-- multi-select
      for (const c of orPack.components) {
        c.conditional = { hide: `= ${key} != "${ch.value}"` };
        components.push(c);
      }
    } // AND: nothing to render
  }

  // leaf tasks at this XOR level (for text placeholders only)
  const options = choices
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
function buildOrChooser(gateway, registry) {
  const outs  = gateway.outgoing || [];
  const seen  = new Set();
  const items = [];

  function addItem(el) {
    const id = el?.id;
    if (!id || seen.has(id)) return;
    seen.add(id);
    items.push({ label: labelOf(el, "Next task"), value: id });
  }

  for (const sf of outs) {
    const tgt = sf.target;
    if (!tgt) continue;
    const typ = tgt?.businessObject?.$type || tgt?.type || "";

    if (typ.includes("Gateway")) {
      const leaves = collectUserTasksFromGatewayTarget(tgt, registry);
      for (const leaf of leaves) addItem(leaf);
    } else if (typ === "bpmn:UserTask" || typ === "bpmn:CallActivity" || typ === "bpmn:SubProcess") {
      addItem(tgt);
    }
  }

  return {
    options: items,
    // single component — no wrapper group, no headline/box
    components: [{
      type: "select",
      key: "nextTasks",
      label: labelOf(gateway, "Please choose"),
      multiple: true,               // <-- this makes it a multi-select
      validate: { required: true },
      values: items.map(o => ({ label: o.label, value: o.value }))
    }]
  };
}


/* Fallback for OR/AND at level 1 (original flat logic) */
function buildChooserForGateway(gateway, kind, registry) {
  if (kind === "XOR") {
    return buildCascadingChooser(gateway, registry, 1);
  }
  
  if (kind === "OR") {
    return buildOrChooser(gateway, registry);
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
    out = swapWordCI(out, "ReferencesPlaceholder",          context.refsHtml ?? "");

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
  
  console.log(`[applyChooserPlaceholder] Called with chooser=${!!chooserComponentsOrNull}, components=${chooserComponentsOrNull?.length || 0}`);

  const isNextToken = (s) => {
    if (typeof s !== "string") return false;
    const t = s.trim();
    return /\bNextTaskPlaceholder\b/i.test(t) || /\bNextTasksPlaceholder\b/i.test(t);
  };

  // Check if ANY string property on a node contains the token
  const nodeHasToken = (node) => {
    if (!node || typeof node !== "object") return false;
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (typeof val === "string" && isNextToken(val)) return true;
    }
    return false;
  };

  // Splice helper: replace one node with N nodes
  function replaceWithMany(list, index, newNodes) {
    list.splice(index, 1, ...newNodes);
  }

  let done = false;

  function walk(list) {
    for (let i = 0; i < list.length; i++) {
      const node = list[i];

      // Check if this node itself has the token in any string property
      if (nodeHasToken(node)) {
        console.log(`[applyChooserPlaceholder] Found token in node at index ${i}, replacing=${!!chooserComponentsOrNull}`);
        if (!chooserComponentsOrNull) {
          list.splice(i, 1);
        } else {
          replaceWithMany(list, i, chooserComponentsOrNull);
        }
        done = true;
        return;
      }

      // Container with children: if any child has the token, replace the whole container
      if (node && Array.isArray(node.components)) {
        const hasTokenChild = node.components.some((c) => nodeHasToken(c));
        if (hasTokenChild) {
          console.log(`[applyChooserPlaceholder] Found token in child of node at index ${i}, replacing=${!!chooserComponentsOrNull}`);
          if (!chooserComponentsOrNull) {
            list.splice(i, 1);
          } else {
            replaceWithMany(list, i, chooserComponentsOrNull);
          }
          done = true;
          return;
        }
        // recurse
        walk(node.components);
        if (done) return;
      }
    }
  }

  walk(formJson.components);
  
  if (!done) {
    console.log(`[applyChooserPlaceholder] Token not found in form`);
  }
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

function escapeHTML(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildReferencesHtml(refs) {
  if (!Array.isArray(refs) || refs.length === 0) return "";
  const items = refs.map((r) => {
    const name = escapeHTML(r?.name || r?.url || "Document");
    const url  = escapeHTML(r?.url || "#");
    return `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a></li>`;
  });
  return `<ul>${items.join("")}</ul>`;
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
