// /lib/formgen-core.js
// Camunda 8 form generator + BPMN enricher (plain JS)
// - Plain-text placeholders (no braces/ids)
// - XOR cascades: nested dropdowns with conditional.hide FEEL
// - OR: multi-select (form-js compatible), collects all reachable leaf tasks
// - AND: no chooser
// - FEEL: recursive for XOR; flat for OR/AND

import JSZip from "jszip";

/** Public API */
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
  const ts = isoCompact(now);

  // StartEvents + UserTasks
  const allEls = elementRegistry.getAll();
  const nodes = allEls.filter((el) => {
    const t = el?.businessObject?.$type || el?.type || "";
    return t === "bpmn:StartEvent" || t === "bpmn:UserTask";
  });

  for (const node of nodes) {
    const isStart  = (node.businessObject?.$type || node.type) === "bpmn:StartEvent";
    const template = deepClone(isStart ? templates.firstStep : templates.nextStep);

    // First gateway after this node (if any)
    const nextGw = firstGatewayAfter(node);
    const kind   = nextGw ? gatewayType(nextGw) : null;

    // Build chooser
    const chooserPack = nextGw
      ? buildChooserForGateway(nextGw, kind, elementRegistry)
      : { components: null, options: [] };

    // Put chooser where plain NextTask(s)Placeholder appears (or remove section)
    applyChooserPlaceholder(template, chooserPack.components);

    // Replace placeholders
    const stepName        = labelOf(node, "");
    const stepDescription = await getStepDescriptionFallback(node);
    const nextTaskText    = buildNextTaskText(kind || "AND", chooserPack.options);
    const chooserExists   = Array.isArray(chooserPack.components) && chooserPack.components.length > 0;

    replacePlaceholdersInForm(
      template,
      { serviceName, stepName, stepDescription, nextTaskText },
      { forceBlankNextTask: chooserExists }
    );

    // Form id + filename
    const baseName = isStart ? "000-start" : `${zeroPadOrder(node)}-${slug(stepName) || node.id}`;
    const formId   = `${baseName}-${ts}`;

    ensureSchemaV4(template);
    template.id = formId;

    // Attach zeebe:formDefinition
    attachFormDefinition(node, formId, moddle, modeling);

    // FEEL conditions
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

/* ───────────────────────── Helpers: BPMN graph ───────────────────────── */

function firstGatewayAfter(node) {
  const outs = (node.outgoing || []).filter(sf => sf && sf.target);
  for (const sf of outs) {
    const t = sf.target;
    const type = t?.businessObject?.$type || t?.type || "";
    if (type.includes("Gateway")) return t;
  }
  return null;
}

function gatewayType(g) {
  const t = g?.businessObject?.$type || g?.type || "";
  if (t.endsWith("ExclusiveGateway")) return "XOR";
  if (t.endsWith("InclusiveGateway")) return "OR";
  if (t.endsWith("ParallelGateway"))  return "AND";
  return null;
}

function safeName(el) {
  const n = el?.businessObject?.name;
  return (typeof n === "string" && n.trim()) ? n.trim() : "";
}

function labelOf(el, fallback) {
  const n = safeName(el);
  return n || fallback; // never fall back to id
}

// Compatibility alias (older references)
function displayName(el) { return labelOf(el, ""); }

/* Collect leaf tasks reachable from a target (for OR builder) */
function collectUserTasksFromGatewayTarget(target, registry, seen = new Set()) {
  if (!target || seen.has(target.id)) return [];
  seen.add(target.id);

  const type = target.businessObject?.$type || target.type || "";
  if (
    type === "bpmn:UserTask" ||
    type === "bpmn:CallActivity" ||
    type === "bpmn:SubProcess"
  ) {
    return [target];
  }
  if (type.includes("Gateway")) {
    let res = [];
    for (const sf of target.outgoing || []) {
      if (sf.target) res = res.concat(collectUserTasksFromGatewayTarget(sf.target, registry, seen));
    }
    return res;
  }
  return [];
}

/* ─────────────── XOR cascades: UI + recursive FEEL ─────────────── */

function varKeyForLevel(level) {
  return level === 1 ? "nextTask" : `nextTask_${level}`;
}

function buildCascadingChooser(gateway, registry, level = 1) {
  const key   = varKeyForLevel(level);
  const label = labelOf(gateway, "Please choose");

  const outs    = gateway.outgoing || [];
  const targets = outs.map(sf => sf.target).filter(Boolean);

  // options include both immediate tasks and gateways
  const seen = new Set();
  const values = [];
  for (const t of targets) {
    const id = t?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const typ = t?.businessObject?.$type || t?.type || "";
    const fallback = typ.includes("Gateway") ? "Next decision" : "Next task";
    values.push({
      label: labelOf(t, fallback),
      value: id,
      _type: typ
    });
  }

  const components = [{
    type: "select",
    key,
    label,
    validate: { required: true },
    values: values.map(v => ({ label: v.label, value: v.value }))
  }];

  // conditional child groups for gateway options (Camunda FEEL conditional)
  for (const v of values) {
    if ((v._type || "").includes("Gateway")) {
      const gw = targets.find(t => t.id === v.value);
      if (!gw) continue;
      const child = buildCascadingChooser(gw, registry, level + 1);
      components.push({
        type: "group",
        label: labelOf(gw, "Please choose"),
        conditional: { hide: `= ${key} != "${v.value}"` }, // show only if parent equals this gateway id
        components: child.components
      });
    }
  }

  // leaf tasks at this immediate level
  const options = values
    .filter(v => !(v._type || "").includes("Gateway"))
    .map(v => ({ label: v.label, value: v.value }));

  return { components, options };
}

function enrichGatewayConditionsRecursive(gateway, registry, moddle, modeling, level = 1) {
  const kind = gatewayType(gateway);
  const outs = gateway.outgoing || [];
  const key  = varKeyForLevel(level);

  if (kind !== "XOR") {
    // Non-XOR: keep flat
    enrichGatewayConditions(gateway, kind, registry, moddle, modeling);
    return;
  }

  // default flow = last (no condition)
  const defaultFlow = outs.length ? outs[outs.length - 1] : null;
  if (defaultFlow) modeling.updateProperties(gateway, { default: defaultFlow });

  for (const sf of outs) {
    const tgt = sf.target;
    const t   = tgt?.businessObject?.$type || tgt?.type || "";

    if (defaultFlow && sf === defaultFlow) {
      modeling.updateProperties(sf, { conditionExpression: null });
    } else {
      const expr = `= ${key} = "${tgt?.id || ""}"`;
      const ce   = moddle.create("bpmn:FormalExpression", { body: expr, language: "feel" });
      modeling.updateProperties(sf, { conditionExpression: ce });
    }

    if (t.includes("Gateway")) {
      enrichGatewayConditionsRecursive(tgt, registry, moddle, modeling, level + 1);
    }
  }
}

/* ─────────────── OR (inclusive): multi-select builder ─────────────── */

function buildOrChooser(gateway, registry) {
  const outs = gateway.outgoing || [];
  const seen = new Set();
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
    } else if (
      typ === "bpmn:UserTask" ||
      typ === "bpmn:CallActivity" ||
      typ === "bpmn:SubProcess"
    ) {
      addItem(tgt);
    }
  }

  return {
    options: items,
    components: [
      {
        type: "select",
        key: "nextTasks",
        label: labelOf(gateway, "Please choose"),
        multiple: true,
        validate: { required: true },
        values: items.map(o => ({ label: o.label, value: o.value }))
      }
    ]
  };
}

/* Wrapper: choose XOR/OR/AND builder */
function buildChooserForGateway(gateway, kind, registry) {
  if (kind === "XOR") return buildCascadingChooser(gateway, registry, 1);
  if (kind === "OR")  return buildOrChooser(gateway, registry);
  return { options: [], components: null }; // AND / unknown
}

/* Flat FEEL for non-XOR */
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
    const tgt  = sf.target;
    const expr = (kind === "XOR")
      ? `= nextTask = "${tgt?.id || ""}"`
      : `= list contains(nextTasks, "${tgt?.id || ""}")`;
    const ce = moddle.create("bpmn:FormalExpression", { body: expr, language: "feel" });
    modeling.updateProperties(sf, { conditionExpression: ce });
  }
}

/* ─────────────── Placeholder replacement & chooser placement ─────────────── */

function replacePlaceholdersInForm(
  formJson,
  context,
  { forceBlankNextTask = false } = {}
) {
  const swapWordCI = (s, word, val) => s.replace(new RegExp(`\\b${word}\\b`, "gi"), val);

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

    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === "string") node[k] = swap(v);
    }

    if (Array.isArray(node.values)) {
      node.values.forEach((opt) => {
        if (opt && typeof opt.label === "string") opt.label = swap(opt.label);
      });
    }

    if (Array.isArray(node.components)) node.components.forEach(walk);
  }

  walk(formJson);
  return formJson;
}

// Find plain "NextTask(s)Placeholder" and replace with chooser (or remove)
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
          list.splice(i, 1);
        } else {
          list[i] = { type: "group", label: "Next step(s)", components: chooserComponentsOrNull };
        }
        replaced = true;
        return;
      }

      // Container containing the token → treat as chooser section
      const isContainer = node && Array.isArray(node.components) &&
        ['group','panel','fieldset','container','section','accordion','tab','tabs','card']
          .includes((node.type || '').toLowerCase());

      if (isContainer) {
        const idx = node.components.findIndex(c => c?.type === "text" && isNextToken(c.text));
        if (idx !== -1) {
          if (!chooserComponentsOrNull) {
            list.splice(i, 1);
          } else {
            node.type = "group";
            node.label = node.label || "Next step(s)";
            node.components = chooserComponentsOrNull;
          }
          replaced = true;
          return;
        }
        walk(node.components, node);
        if (replaced) return;
      }

      if (Array.isArray(node?.components)) {
        walk(node.components, node);
        if (replaced) return;
      }
    }
  }

  walk(formJson.components, null);
}

/* ───────────────────────── Misc utilities ───────────────────────── */

function ensureSchemaV4(form) {
  if (!form.schemaVersion) form.schemaVersion = 4;
  if (!form.type) form.type = "form";
}

function attachFormDefinition(node, formId, moddle, modeling) {
  const bo  = node.businessObject;
  const ext = bo.extensionElements || moddle.create("bpmn:ExtensionElements");
  const values = (ext.values || []).filter(v => v.$type !== "zeebe:FormDefinition");

  const formDef = moddle.create("zeebe:FormDefinition", {
    formId,
    binding: "deployment"
  });

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

async function getStepDescriptionFallback(/* node */) { return ""; }

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function slug(s) {
  return (s || "")
    .toString().trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/-+/g, "-");
}

function isoCompact(d) {
  const iso = d.toISOString(); // 2025-10-26T23:54:16.123Z
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function zeroPadOrder(node) {
  const y = node.di?.bounds?.y ?? 0;
  const x = node.di?.bounds?.x ?? 0;
  const ord = (y * 1000 + x) | 0;
  return String(Math.max(0, Math.min(999, ord))).padStart(3, "0");
}
