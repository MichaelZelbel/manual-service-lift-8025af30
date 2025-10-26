// /lib/formgen-core.js
// Plain JavaScript core to (a) enrich BPMN with FEEL + form bindings
// and (b) generate Camunda Tasklist forms + a ZIP bundle.
//
// Dependencies: jszip (runtime)
// Assumes you already have a bpmn-js Modeler instance in your app.

// eslint-disable-next-line import/no-extraneous-dependencies
import JSZip from 'jszip';
import { getStepDescription, getServiceDescription } from '../src/utils/stepDescriptions.js';

// ———————————————————————————————————————————————
// Public API
// ———————————————————————————————————————————————

/**
 * @typedef {Object} GenerateOptions
 * @property {string} serviceName
 * @property {any} bpmnModeler  // bpmn-js Modeler instance
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
 * @param {GenerateOptions} opts
 * @returns {Promise<GeneratedBundle>}
 */
export async function generateBundle (opts) {
  const { serviceName, bpmnModeler, templates, now = new Date() } = opts;

  if (!bpmnModeler) throw new Error('generateBundle: bpmnModeler is required');
  if (!templates?.firstStep || !templates?.nextStep) {
    throw new Error('generateBundle: templates.firstStep and templates.nextStep are required');
  }

  const elementRegistry = bpmnModeler.get('elementRegistry');
  const modeling = bpmnModeler.get('modeling');
  const moddle = bpmnModeler.get('moddle');

  const forms = [];
  const ts = isoCompact(now); // e.g. 20251023T224512Z

  // 1) Find StartEvents + UserTasks
  const nodes = elementRegistry.filter(el =>
    el.type === 'bpmn:StartEvent' || el.type === 'bpmn:UserTask'
  );

  for (const node of nodes) {
    const isStart = node.type === 'bpmn:StartEvent';
    const template = deepClone(isStart ? templates.firstStep : templates.nextStep);

    // 2) detect gateway after node
    const nextGw = firstGatewayAfter(node);
    const kind = nextGw ? gatewayType(nextGw) : null;

    // 3) chooser pack (components + options for placeholder text)
    const chooserPack = nextGw
      ? buildChooserForGateway(nextGw, kind, elementRegistry)
      : { components: null, options: [] };

    // 4) swap/remove placeholder group
    applyChooserPlaceholder(template, chooserPack.components);

    // 5) fill standard placeholders across the template
    const stepName = displayName(node);
    const stepDescription = node.type === 'bpmn:StartEvent'
      ? (await getServiceDescription(serviceName)) || ''
      : (await getStepDescription(serviceName, node)) || '';
    const nextTaskText = (kind
      ? buildNextTaskText(kind, chooserPack.options)  // gateway present
      : buildNextTaskTextLinear(node)                 // linear path
    ) || '';
    const referencesText = buildReferencesText(getNodeReferencesFromMds(node));

    replacePlaceholdersInForm(template, {
      serviceName,
      stepName,
      stepDescription,
      nextTaskText,
      referencesText
    });

    // 6) form IDs & filenames
    const baseName = isStart ? '000-start' : `${zeroPadOrder(node)}-${slug(stepName) || node.id}`;
    const formId = `${baseName}-${ts}`;
    ensureSchemaV4(template);
    template.id = formId;

    // 7) attach form binding to BPMN node
    attachFormDefinition(node, formId, moddle, modeling);

    // 8) enrich FEEL conditions for outgoing gateway
    if (nextGw) enrichGatewayConditions(nextGw, kind, elementRegistry, moddle, modeling);

    forms.push({
      nodeId: node.id,
      name: stepName,
      filename: `${baseName}.form`,
      formId,
      json: template
    });
  }

  // 9) export BPMN XML
  const { xml: updatedBpmnXml } = await bpmnModeler.saveXML({ format: true });

  // 10) manifest
  const manifest = {
    service: serviceName,
    generatedAt: now.toISOString(),
    forms: forms.map(({ nodeId, name, filename, formId }) => ({ nodeId, name, filename, formId }))
  };

  // 11) ZIP
  const zip = new JSZip();
  zip.file('manual-service.bpmn', updatedBpmnXml);
  for (const f of forms) zip.file(f.filename, JSON.stringify(f.json, null, 2));
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  const zipBinary = await zip.generateAsync({ type: 'uint8array' });

  return { updatedBpmnXml, forms, manifest, zipBinary };
}

// ----------------------------------------------
// Helpers: BPMN graph & enrichment
// ----------------------------------------------

function firstGatewayAfter (node) {
  const outgoing = (node.outgoing || []).filter(sf => sf && sf.target);
  if (!outgoing.length) return null;

  // If there’s more than one outgoing directly from a user task, you likely
  // modeled it with a gateway already—prefer the first gateway target.
  for (const sf of outgoing) {
    const t = sf.target;
    const type = t.type || t.businessObject?.$type || '';
    if (type.startsWith('bpmn:') && type.includes('Gateway')) return t;
  }
  return null;
}

function gatewayType (g) {
  const t = g.type || g.businessObject?.$type || '';
  if (t.endsWith('ExclusiveGateway')) return 'XOR';
  if (t.endsWith('InclusiveGateway')) return 'OR';
  if (t.endsWith('ParallelGateway')) return 'AND';
  return null;
}

function displayName (el) {
  return el.businessObject?.name || el.id || '';
}

function firstUserTaskAfter(node) {
  const out = (node.outgoing || []).filter(sf => sf && sf.target);
  if (!out.length) return null;
  // follow straight line: Start/UserTask -> (maybe intermediate tasks) -> next User Task
  // For prototype, we stop at first direct target:
  const t = out[0].target;
  if (!t) return null;
  const type = t.businessObject?.$type || t.type || '';
  if (type === 'bpmn:UserTask') return t;
  // If it's not a user task (e.g., end), return null for now (simple linear models)
  return null;
}

function buildNextTaskTextLinear(node) {
  const nxt = firstUserTaskAfter(node);
  return nxt ? displayName(nxt) : '';
}

function resolveToUserTask (el /*, registry */) {
  if (!el) return null;
  const t = el.businessObject?.$type || el.type;
  if (t === 'bpmn:UserTask') return el;
  // Prototype assumption: gateway connects directly to user tasks.
  // Extend here if you insert script/service tasks in between.
  return null;
}

/**
 * Build chooser components and option list for a gateway.
 * @returns {{components: object[]|null, options: Array<{label:string,value:string}>}}
 */
function buildChooserForGateway (gateway, kind, registry) {
  const outs = gateway.outgoing || [];
  const options = outs.map(sf => {
    const tgt = resolveToUserTask(sf.target, registry);
    return tgt ? { label: displayName(tgt), value: tgt.id } : null;
  }).filter(Boolean);

  if (kind === 'XOR') {
    return {
      options,
      components: [{
        type: 'select',
        key: 'nextTask',
        label: 'Choose the next task',
        validate: { required: true },
        values: options.map(o => ({ label: o.label, value: o.value }))
      }]
    };
  }
  if (kind === 'OR') {
    return {
      options,
      components: [{
        type: 'checkbox-group',
        key: 'nextTasks',
        label: 'Select all next tasks that apply',
        validate: { required: true },
        values: options.map(o => ({ label: o.label, value: o.value }))
      }]
    };
  }
  // AND: no chooser (submit button only)
  return { options: [], components: null };
}

function applyChooserPlaceholder (formJson, chooserComponentsOrNull) {
  if (!formJson?.components) return;
  const i = formJson.components.findIndex(c => c.id === 'NextTaskChooserPlaceholder');
  if (i < 0) return;

  if (!chooserComponentsOrNull) {
    // AND → remove placeholder group entirely
    formJson.components.splice(i, 1);
  } else {
    if (!formJson.components[i].components) formJson.components[i].components = [];
    formJson.components[i].components = chooserComponentsOrNull;
  }
}

function ensureSchemaV4 (form) {
  if (!form.schemaVersion) form.schemaVersion = 4;
  if (!form.type) form.type = 'form';
}

function attachFormDefinition (node, formId, moddle, modeling) {
  const bo = node.businessObject;
  const existingExt = bo.extensionElements;
  const ext = existingExt || moddle.create('bpmn:ExtensionElements');

  // Remove any prior FormDefinition to avoid duplicates
  const values = (ext.values || []).filter(v => v.$type !== 'zeebe:FormDefinition');

  const formDef = moddle.create('zeebe:FormDefinition', {
    formId,
    bindingType: 'deployment'
  });

  // For user tasks, adding zeebe:UserTask extension is harmless/helpful
  if (bo.$type === 'bpmn:UserTask') {
    const userTaskExt = moddle.create('zeebe:UserTask', {});
    values.push(formDef, userTaskExt);
  } else {
    values.push(formDef);
  }

  ext.values = values;
  modeling.updateProperties(node, { extensionElements: ext });
}

function enrichGatewayConditions (gateway, kind, registry, moddle, modeling) {
  const outs = gateway.outgoing || [];

  if (kind === 'AND') {
    // Ensure no conditions are present
    outs.forEach(sf => modeling.updateProperties(sf, { conditionExpression: null }));
    return;
  }

  // For XOR, pick one default (no condition); for simplicity choose the last.
  let defaultFlow = null;
  if (kind === 'XOR' && outs.length) {
    defaultFlow = outs[outs.length - 1];
    modeling.updateProperties(gateway, { default: defaultFlow });
  }

  for (const sf of outs) {
    if (kind === 'XOR' && sf === defaultFlow) {
      modeling.updateProperties(sf, { conditionExpression: null });
      continue;
    }
    const tgt = resolveToUserTask(sf.target, registry);
    const value = tgt ? tgt.id : '';

    const expr = (kind === 'XOR')
      ? `= nextTask = "${value}"`
      : `= list contains(nextTasks, "${value}")`;

    const ce = moddle.create('bpmn:FormalExpression', { body: expr, language: 'feel' });
    modeling.updateProperties(sf, { conditionExpression: ce });
  }
}

// ———————————————————————————————————————————————
// Helpers: placeholders
// ———————————————————————————————————————————————

const REPLACE_FIELDS = new Set(['text', 'label', 'description', 'help', 'placeholder']);

function replacePlaceholdersInForm (formJson, context) {
  function swap (s = '') {
    return String(s)
      .replaceAll('{{ManualServiceNamePlaceholder}}', context.serviceName || '')
      .replaceAll('{{ProcessStepPlaceholder}}', context.stepName || '')
      .replaceAll('{{ProcessDescriptionPlaceholder}}', context.stepDescription || '')
      .replaceAll('{{NextTaskPlaceholder}}', context.nextTaskText || '')
      .replaceAll('{{ReferencesPlaceholder}}', context.referencesText || '');
  }

  function walk (node) {
    if (!node || typeof node !== 'object') return;

    // swap in text-bearing fields
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string' && REPLACE_FIELDS.has(k)) node[k] = swap(v);
    }

    // replace in option labels too
    if (Array.isArray(node.values)) {
      node.values.forEach(opt => {
        if (opt && typeof opt.label === 'string') opt.label = swap(opt.label);
      });
    }

    // recurse into children
    if (Array.isArray(node.components)) node.components.forEach(walk);
  }

  walk(formJson);
  return formJson;
}

function getNodeReferencesFromMds(node) {
  // EXPECTATION: your app stores MDS per step somewhere alongside BPMN
  // If you already attach it on node.businessObject.$attrs (custom attrs), read it there.
  // For now, check a conventional place and fall back to empty.
  const attrs = node.businessObject?.$attrs || {};
  // Example conventions (adjust to your actual structure):
  // attrs['mds:sopName'] and attrs['mds:sopUrl']
  const refs = [];
  if (attrs['mds:sopName'] && attrs['mds:sopUrl']) {
    refs.push({ name: String(attrs['mds:sopName']), url: String(attrs['mds:sopUrl']) });
  }
  // If you support multiple references:
  // attrs['mds:refs'] as JSON string: [{name,url},...]
  if (attrs['mds:refs']) {
    try {
      const arr = JSON.parse(attrs['mds:refs']);
      if (Array.isArray(arr)) {
        arr.forEach((r) => {
          if (r?.name && r?.url) refs.push({ name: String(r.name), url: String(r.url) });
        });
      }
    } catch (e) { /* ignore */ }
  }
  return refs;
}

function buildReferencesText(refs) {
  if (!refs || !refs.length) return '';
  // Camunda text component is plain text; render bullet list with name — url
  return refs.map(r => `• ${r.name} — ${r.url}`).join('\n');
}

function buildNextTaskText (kind, options) {
  if (!options || !options.length) return '';
  const names = options.map(o => o.label);
  if (kind === 'AND') return names.join(', ');
  if (kind === 'OR') return names.join(' • ');
  return names.join(' / ');
}


// ———————————————————————————————————————————————
// Misc utils
// ———————————————————————————————————————————————

function deepClone (o) {
  return JSON.parse(JSON.stringify(o));
}

function slug (s) {
  return (s || '').toString().trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .replace(/-+/g, '-');
}

function isoCompact (d) {
  // 2025-10-23T22:45:12.345Z -> 20251023T224512Z
  const iso = d.toISOString();
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function zeroPadOrder (node) {
  // Simple, deterministic order from DI coords (prototype-friendly)
  const y = node.di?.bounds?.y ?? 0;
  const x = node.di?.bounds?.x ?? 0;
  const ord = (y * 1000 + x) | 0;
  return String(Math.max(0, Math.min(999, ord))).padStart(3, '0');
}
