/**
 * @fileoverview Form Generation Core Library
 * 
 * This library transforms BPMN (Business Process Model and Notation) diagrams into
 * deployable Camunda form bundles. It analyzes the BPMN structure, generates
 * appropriate form UI components based on gateway types, and enriches the BPMN
 * with FEEL (Friendly Enough Expression Language) conditions for routing decisions.
 * 
 * ## Architecture Overview
 * 
 * The library follows these key steps:
 * 1. **Scan BPMN** - Find all StartEvents, UserTasks, and CallActivities
 * 2. **Analyze Gateways** - Detect the first gateway after each node to determine
 *    what kind of task selection UI is needed
 * 3. **Build Choosers** - Generate form components (dropdowns, checkboxes) based on
 *    gateway type (XOR, OR, AND)
 * 4. **Generate Forms** - Create Camunda form JSON from templates, replacing
 *    placeholders with actual content
 * 5. **Enrich BPMN** - Add FEEL conditions to gateway flows and form bindings to nodes
 * 6. **Package** - Create ZIP archive with BPMN, forms, and manifest
 * 
 * ## Gateway Handling Strategy
 * 
 * The library handles three types of BPMN gateways differently:
 * 
 * - **XOR (Exclusive Gateway)**: Creates nested dropdowns for cascading decisions.
 *   Variables are named `nextTask`, `nextTask_2`, `nextTask_3`, etc. for each level.
 *   FEEL conditions check: `nextTask = "taskId"` or `nextTask_2 = "taskId"` etc.
 * 
 * - **OR (Inclusive Gateway)**: Creates a multi-select checkbox group.
 *   Variable is named `nextTasks` (plural). FEEL conditions check:
 *   `list contains(nextTasks, "taskId")`
 * 
 * - **AND (Parallel Gateway)**: No chooser UI needed - all paths execute in parallel.
 *   No conditions are written (all flows are unconditional).
 * 
 * ## Placeholder System
 * 
 * The library uses plain-text placeholders (case-insensitive, whole-word matching):
 * - `ManualServiceNamePlaceholder` → Service name
 * - `ProcessStepPlaceholder` → Current step name
 * - `ProcessDescriptionPlaceholder` → Step description
 * - `NextTaskPlaceholder` / `NextTasksPlaceholder` → Replaced with chooser components
 * - `ReferencesPlaceholder` → HTML list of reference links
 * 
 * Placeholders can appear anywhere in the form JSON (labels, text content, etc.)
 * and will be replaced automatically.
 * 
 * @module formgen-core
 */

import JSZip from "jszip";

/**
 * Configuration options for form bundle generation.
 * 
 * @typedef {Object} GenerateOptions
 * @property {string} serviceName - Name of the service/process (used in placeholders)
 * @property {any} bpmnModeler - BPMN.js modeler instance (must have elementRegistry, modeling, moddle)
 * @property {{ firstStep: object, nextStep: object }} templates - Form templates:
 *   - `firstStep`: Template for StartEvent forms
 *   - `nextStep`: Template for UserTask/CallActivity forms
 * @property {Date} [now] - Timestamp for generation (defaults to current date)
 * @property {Function} [resolveDescriptions] - Optional async callback to resolve
 *   step descriptions and references: `(node) => Promise<{stepDescription: string, references: Array}>`
 */

/**
 * Generated form bundle containing all artifacts.
 * 
 * @typedef {Object} GeneratedBundle
 * @property {string} updatedBpmnXml - BPMN XML with FEEL conditions and form bindings
 * @property {Array<{nodeId:string,name:string,filename:string,formId:string,json:object}>} forms
 *   - Array of generated form objects:
 *     - `nodeId`: BPMN element ID this form belongs to
 *     - `name`: Human-readable step name
 *     - `filename`: Filename for the form file (e.g., "001-step-name.form")
 *     - `formId`: Unique form identifier
 *     - `json`: Complete Camunda form JSON object
 * @property {object} manifest - Metadata about the generated bundle
 *   - `service`: Service name
 *   - `generatedAt`: ISO timestamp
 *   - `forms`: Array of form metadata (nodeId, name, filename, formId)
 * @property {Uint8Array} zipBinary - Binary ZIP archive containing all files
 */

/**
 * Main entry point: Generates a complete form bundle from a BPMN model.
 * 
 * This function:
 * 1. Scans the BPMN for all StartEvents, UserTasks, and CallActivities
 * 2. For each node, analyzes the gateway structure to determine what chooser UI is needed
 * 3. Generates form JSON from templates, replacing placeholders with actual content
 * 4. Enriches the BPMN with FEEL conditions and form bindings
 * 5. Creates a manifest and ZIP archive containing all artifacts
 * 
 * @param {GenerateOptions} opts - Configuration options
 * @returns {Promise<GeneratedBundle>} Complete form bundle with BPMN, forms, manifest, and ZIP
 * @throws {Error} If bpmnModeler or templates are missing
 * 
 * @example
 * const bundle = await generateBundle({
 *   serviceName: "My Process",
 *   bpmnModeler: myModeler,
 *   templates: { firstStep: {...}, nextStep: {...} },
 *   resolveDescriptions: async (node) => ({ stepDescription: "...", references: [...] })
 * });
 */
export async function generateBundle(opts) {
  const { serviceName, bpmnModeler, templates, now = new Date(), resolveDescriptions } = opts;

  // Validate required inputs
  if (!bpmnModeler) throw new Error("generateBundle: bpmnModeler is required");
  if (!templates?.firstStep || !templates?.nextStep) {
    throw new Error("generateBundle: templates.firstStep and templates.nextStep are required");
  }

  // Get BPMN.js services needed for traversal and modification
  const elementRegistry = bpmnModeler.get("elementRegistry"); // Access to all BPMN elements
  const modeling        = bpmnModeler.get("modeling");        // Service for modifying BPMN
  const moddle          = bpmnModeler.get("moddle");          // Factory for creating BPMN objects

  const forms = []; // Array to collect all generated forms
  const ts = isoCompact(now); // Timestamp for unique form IDs (e.g., "20251023T224512Z")

  // Step 1: Find all nodes that need forms (StartEvents, UserTasks, CallActivities)
  // These are the only BPMN elements that can have user-facing forms in Camunda
  // Gather StartEvents + UserTasks robustly (exclude label elements)
  const allEls = elementRegistry.getAll();
  const nodes = allEls.filter((el) => {
    const t = el?.businessObject?.$type || el?.type || "";
    // Exclude label elements (they have type="label" and are visual only)
    if (t === "label" || el?.type === "label") return false;
    return t === "bpmn:StartEvent" || t === "bpmn:UserTask" || t === "bpmn:CallActivity";
  });

  // Step 2: Generate a form for each node
  for (const node of nodes) {
    // Determine if this is a StartEvent (uses firstStep template) or UserTask/CallActivity (uses nextStep)
    const isStart = node.type === "bpmn:StartEvent" || node.businessObject?.$type === "bpmn:StartEvent";
    const template = deepClone(isStart ? templates.firstStep : templates.nextStep);

    // Step 3: Analyze gateway structure to determine what chooser UI is needed
    // Find all gateways after this node (handles parallel patterns)
    const gateways = findParallelGateways(node);
    
    console.log(`[formgen] Node ${node.id} (${isStart ? 'START' : 'TASK'}): found ${gateways.length} gateway(s)`);

    // Step 4: Build chooser UI components for all gateways
    // For parallel patterns, multiple choosers will appear together
    const allChooserComponents = [];
    let firstKind = null;
    let allOptions = [];
    
    for (const gw of gateways) {
      const kind = gatewayType(gw);
      if (!firstKind) firstKind = kind;
      console.log(`[formgen]   Gateway ${gw.id}: type=${kind}`);
      const chooserPack = buildChooserForGateway(gw, kind, elementRegistry);
      if (chooserPack.components) {
        allChooserComponents.push(...chooserPack.components);
      }
      if (chooserPack.options) {
        allOptions.push(...chooserPack.options);
      }
    }
    
    console.log(`[formgen] Total chooser components for ${node.id}: ${allChooserComponents.length}`);

    // Step 5: Replace the NextTask(s)Placeholder token in the template with actual chooser components
    // If no chooser exists, the placeholder node is removed
    applyChooserPlaceholder(template, allChooserComponents.length > 0 ? allChooserComponents : null);

    // Step 6: Extract step name from BPMN element
    const stepName = displayName(node);

    // Step 7: Resolve step description and references (optional external callback)
    // This allows external systems to provide enriched descriptions and links
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

    // Step 8: Build HTML for references and text representation of next tasks
    const refsHtml      = buildReferencesHtml(refs);
    const nextTaskText  = buildNextTaskText(firstKind || "AND", allOptions);

    // Check if chooser components exist (if so, we'll blank out NextTask text placeholders)
    const chooserExists = allChooserComponents.length > 0;

    // Step 9: Replace all plain-text placeholders in the form template
    // This replaces things like "ManualServiceNamePlaceholder" with actual service name
    replacePlaceholdersInForm(
      template,
      { serviceName, stepName, stepDescription, nextTaskText, refsHtml },
      { forceBlankNextTask: chooserExists } // Blank NextTask text if chooser UI exists
    );

    // Step 10: Replace ReferencesPlaceholder token with proper HTML list (structural replacement)
    // This is separate from text replacement because it replaces entire nodes/components
    applyReferencesPlaceholder(template, refs);

    // Step 11: Generate unique form ID and filename
    // StartEvents get "000-start", others get ordered by position (e.g., "001-step-name")
    const baseName = isStart
      ? "000-start"
      : `${zeroPadOrder(node)}-${slug(stepName) || node.id}`;
    const formId = `${baseName}-${ts}`; // Unique ID includes timestamp

    // Step 12: Ensure form schema is version 4 (Camunda Forms format)
    ensureSchemaV4(template);
    template.id = formId;

    // Step 13: Attach form binding to the BPMN element
    // This tells Camunda which form to use for this task
    attachFormDefinition(node, formId, moddle, modeling);

    // Step 14: Write FEEL conditions to gateway flows (recursive for XOR cascades)
    // This enables runtime routing based on form field values
    for (const gw of gateways) {
      enrichGatewayConditionsRecursive(gw, elementRegistry, moddle, modeling, 1);
    }

    // Step 15: Collect the generated form
    forms.push({
      nodeId: node.id,
      name: stepName,
      filename: `${baseName}.form`,
      formId,
      json: template,
    });
  }

  // Step 16: Save the enriched BPMN XML (now contains FEEL conditions and form bindings)
  const { xml: updatedBpmnXml } = await bpmnModeler.saveXML({ format: true });

  // Step 17: Create manifest listing all generated forms
  const manifest = {
    service: serviceName,
    generatedAt: now.toISOString(),
    forms: forms.map(({ nodeId, name, filename, formId }) => ({
      nodeId, name, filename, formId
    })),
  };

  // Step 18: Package everything into a ZIP archive
  const zip = new JSZip();
  zip.file("manual-service.bpmn", updatedBpmnXml);
  for (const f of forms) zip.file(f.filename, JSON.stringify(f.json, null, 2));
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  const zipBinary = await zip.generateAsync({ type: "uint8array" });

  return { updatedBpmnXml, forms, manifest, zipBinary };
}

/* ───────────────────────── BPMN graph helpers ───────────────────────── */

/**
 * Finds the first splitting gateway immediately after a given node.
 * 
 * Uses breadth-first search to traverse the BPMN graph from the node's outgoing
 * flows. Returns the first gateway encountered that has more than one outgoing
 * flow (a "splitting" gateway). Merging gateways (single outgoing) are skipped.
 * 
 * @param {any} node - BPMN element (StartEvent, UserTask, etc.)
 * @returns {any|null} First splitting gateway found, or null if none exists
 * 
 * @example
 * // If flow is: UserTask → Gateway (2 outputs), returns that Gateway
 * // If flow is: UserTask → Task → Gateway (2 outputs), returns that Gateway
 * // If flow is: UserTask → Task → Task, returns null
 */
function firstGatewayAfter(node) {
  // Use BFS (breadth-first search) to find the nearest splitting gateway
  const queue = [];
  const visited = new Set(); // Prevent cycles in the graph

  // Seed queue with immediate outgoing targets (next nodes in the flow)
  for (const sf of (node.outgoing || [])) {
    if (sf && sf.target) queue.push(sf.target);
  }

  while (queue.length) {
    const cur = queue.shift();
    if (!cur || visited.has(cur.id)) continue; // Skip if already visited
    visited.add(cur.id);

    const type = cur?.businessObject?.$type || cur?.type || "";
    
    // Check if current node is a gateway
    if (type.includes("Gateway")) {
      const outs = (cur.outgoing || []).filter((f) => f && f.target);
      if (outs.length > 1) return cur; // Found a splitting gateway (multiple outputs)
      
      // Single-outgoing gateway (e.g., merge gateway) — keep traversing
      // Merge gateways don't need choosers, so we continue searching
      for (const f of outs) if (f.target) queue.push(f.target);
      continue;
    }

    // Not a gateway — continue traversal to find one downstream
    for (const f of (cur.outgoing || [])) if (f.target) queue.push(f.target);
  }
  return null; // No splitting gateway found
}

/**
 * Finds all gateways that need choosers after a node, handling parallel patterns.
 * 
 * This function detects two scenarios:
 * 1. **Top-level parallel**: Node → AND gateway → Branch1(XOR/OR) + Branch2(XOR/OR)
 *    Returns all parallel branch gateways as an array
 * 
 * 2. **Single gateway**: Node → XOR/OR gateway (or no parallel pattern found)
 *    Returns single gateway in an array (backward compatible)
 * 
 * Note: Nested parallel detection (parallel within cascade) is handled separately
 * in buildCascadingChooser.
 * 
 * @param {any} node - BPMN element (StartEvent, UserTask, etc.)
 * @returns {Array} Array of gateways that need choosers (empty if none)
 * 
 * @example
 * // Node → AND → (XOR-A, XOR-B) returns [XOR-A, XOR-B]
 * // Node → XOR → tasks returns [XOR]
 * // Node → AND → (Task1, Task2) returns [AND] (even though AND has no chooser)
 */
function findParallelGateways(node) {
  const firstGw = firstGatewayAfter(node);
  if (!firstGw) return [];
  
  const type = gatewayType(firstGw);
  
  // If it's not a parallel gateway, return single gateway (existing behavior)
  if (type !== "AND") return [firstGw];
  
  // It's a parallel gateway - find all XOR/OR gateways in parallel branches
  const parallelGateways = [];
  for (const flow of (firstGw.outgoing || [])) {
    if (!flow.target) continue;
    const branchGw = firstGatewayAfter(flow.target);
    if (branchGw) {
      const branchType = gatewayType(branchGw);
      if (branchType === "XOR" || branchType === "OR") {
        parallelGateways.push(branchGw);
      }
    }
  }
  
  // If no XOR/OR gateways found in branches, return the AND gateway itself
  // (even though AND gateways don't generate choosers)
  return parallelGateways.length > 0 ? parallelGateways : [firstGw];
}

/**
 * Determines the type of a BPMN gateway.
 * 
 * BPMN gateways control flow routing:
 * - ExclusiveGateway (XOR): Exactly one path is taken (mutually exclusive)
 * - InclusiveGateway (OR): One or more paths can be taken (inclusive)
 * - ParallelGateway (AND): All paths are taken in parallel (synchronization)
 * 
 * @param {any} g - BPMN gateway element
 * @returns {string|null} Gateway type: "XOR", "OR", "AND", or null if not a gateway
 */
function gatewayType(g) {
  const t = g?.businessObject?.$type || g?.type || "";
  if (t.endsWith("ExclusiveGateway"))  return "XOR";   // Mutually exclusive paths
  if (t.endsWith("InclusiveGateway"))  return "OR";    // One or more paths
  if (t.endsWith("ParallelGateway"))   return "AND";    // All paths in parallel
  return null;
}

/**
 * Safely extracts the name from a BPMN element.
 * 
 * @param {any} el - BPMN element
 * @returns {string} Element name (trimmed), or empty string if not available
 */
function safeName(el) {
  const n = el?.businessObject?.name;
  return (typeof n === 'string' && n.trim()) ? n.trim() : '';
}

/**
 * Gets a label for a BPMN element, using a fallback if no name is set.
 * 
 * Never falls back to the element ID - only uses the provided fallback.
 * This ensures human-readable labels are always used.
 * 
 * @param {any} el - BPMN element
 * @param {string} fallback - Fallback text if element has no name
 * @returns {string} Element name or fallback (never the ID)
 */
function labelOf(el, fallback) {
  const n = safeName(el);
  return n || fallback; // never fall back to id
}

/**
 * Gets the display name for a BPMN element.
 * 
 * Compatibility alias for older code that uses `displayName`.
 * 
 * @param {any} el - BPMN element
 * @returns {string} Element name or empty string
 */
function displayName(el) {
  return labelOf(el, "");
}

/**
 * Recursively collects all UserTasks, CallActivities, and SubProcesses
 * reachable from a gateway target.
 * 
 * This is used for OR gateways, where we need to show all possible
 * leaf tasks that can be selected, even if they're nested behind
 * other gateways.
 * 
 * @param {any} target - BPMN element to start traversal from
 * @param {any} registry - BPMN element registry (for lookups)
 * @param {Set} seen - Set of already visited element IDs (prevents cycles)
 * @returns {Array<any>} Array of UserTask, CallActivity, and SubProcess elements
 * 
 * @example
 * // If OR gateway has: Task1, Gateway → Task2, Task3
 * // Returns: [Task1, Task2, Task3]
 */
function collectUserTasksFromGatewayTarget(target, registry, seen = new Set()) {
  // Prevent infinite loops in cyclic graphs
  if (!target || seen.has(target.id)) return [];
  seen.add(target.id);

  const type = target.businessObject?.$type || target.type || "";
  
  // If this is a task node, return it (leaf node)
  if (
    type === "bpmn:UserTask" ||
    type === "bpmn:CallActivity" ||
    type === "bpmn:SubProcess"
  ) return [target];

  // If this is a gateway, recursively collect tasks from all paths
  if (type.includes("Gateway")) {
    let result = [];
    for (const sf of target.outgoing || []) {
      if (sf.target) {
        result = result.concat(
          collectUserTasksFromGatewayTarget(sf.target, registry, seen)
        );
      }
    }
    return result;
  }
  
  // Other node types (e.g., IntermediateCatchEvent) - no tasks here
  return [];
}

/* ─────────────── Cascading XOR chooser + recursive FEEL ─────────────── */

/**
 * Gets the variable name for a given nesting level in cascading XOR gateways.
 * 
 * For cascading XOR gateways, we need nested variables:
 * - Level 1: "nextTask"
 * - Level 2: "nextTask_2"
 * - Level 3: "nextTask_3"
 * etc.
 * 
 * These variables are used in FEEL conditions to route the process flow.
 * 
 * @param {number} level - Nesting level (1-based)
 * @returns {string} Variable name for this level
 */
function varKeyForLevel(level) {
  return level === 1 ? "nextTask" : `nextTask_${level}`;
}

/**
 * Builds nested dropdown components for cascading XOR gateways.
 * 
 * When XOR gateways are nested (one XOR gateway leads to another),
 * this function creates a cascading dropdown structure:
 * - First dropdown: "nextTask" (selects from first gateway options)
 * - If a gateway is selected, second dropdown appears: "nextTask_2"
 * - If another gateway is selected, third dropdown appears: "nextTask_3"
 * - And so on...
 * 
 * Child dropdowns are conditionally shown based on the parent selection
 * using FEEL expressions: `= nextTask != "optionId"` (hide condition).
 * 
 * If a child gateway is OR type, it creates a multi-select checkbox instead.
 * AND gateways don't generate any UI (all paths execute).
 * 
 * @param {any} gateway - XOR gateway element
 * @param {any} registry - BPMN element registry
 * @param {number} level - Current nesting level (default: 1)
 * @returns {{components: Array, options: Array}} Chooser components and options
 *   - `components`: Array of form components (dropdowns, checkboxes)
 *   - `options`: Array of leaf task options (for text placeholders)
 * 
 * @example
 * // Gateway 1 → Gateway 2 → Task A, Task B
 * // Creates: dropdown1 (nextTask), dropdown2 (nextTask_2, shown when Gateway 2 selected)
 */
function buildCascadingChooser(gateway, registry, level = 1) {
  const key   = level === 1 ? "nextTask" : `nextTask_${level}`;
  const label = labelOf(gateway, "Please choose");

  // Get all targets from this gateway's outgoing flows
  const outs    = gateway.outgoing || [];
  const targets = outs.map(sf => sf.target).filter(Boolean);

  // Build list of choices (avoid duplicates)
  const seen    = new Set();
  const choices = [];
  for (const t of targets) {
    const id = t?.id;
    if (!id || seen.has(id)) continue; // Skip duplicates
    seen.add(id);
    const typ = t?.businessObject?.$type || t?.type || "";
    const fallback = typ.includes("Gateway") ? "Next decision" : "Next task";
    choices.push({ label: labelOf(t, fallback), value: id, _type: typ, _el: t });
  }

  // Create the top-level select dropdown for this XOR level
  // Single-select dropdown (no wrapper group)
  const components = [{
    type: "select",
    key,
    label,
    validate: { required: true },
    values: choices.map(v => ({ label: v.label, value: v.value }))
  }];

  // For any choice that is itself a gateway, recursively build child choosers
  // Child choosers are conditionally shown based on parent selection
  for (const ch of choices) {
    if (!(ch._type || "").includes("Gateway")) continue; // Skip non-gateway choices

    const childGw   = ch._el;
    const childKind = gatewayType(childGw);

    // If child is XOR: recursively build nested dropdowns
    if (childKind === "XOR") {
      const child = buildCascadingChooser(childGw, registry, level + 1);
      // Add conditional visibility: hide unless parent selects this option
      for (const c of child.components) {
        c.conditional = { hide: `= ${key} != "${ch.value}"` };
        components.push(c);
      }
    } else if (childKind === "OR") {
      // If child is OR: create multi-select checkbox group
      const orPack = buildOrChooser(childGw, registry);
      for (const c of orPack.components) {
        c.conditional = { hide: `= ${key} != "${ch.value}"` };
        components.push(c);
      }
    } else if (childKind === "AND") {
      // If child is AND (parallel): find all XOR/OR gateways in parallel branches
      // and create choosers for all of them that appear together when this choice is selected
      const parallelChooserComponents = [];
      for (const flow of (childGw.outgoing || [])) {
        if (!flow.target) continue;
        const branchGw = firstGatewayAfter(flow.target);
        if (branchGw) {
          const branchType = gatewayType(branchGw);
          if (branchType === "XOR") {
            // Build cascading chooser for this parallel XOR branch
            const branchChooser = buildCascadingChooser(branchGw, registry, level + 1);
            parallelChooserComponents.push(...branchChooser.components);
          } else if (branchType === "OR") {
            // Build OR chooser for this parallel OR branch
            const branchChooser = buildOrChooser(branchGw, registry);
            parallelChooserComponents.push(...branchChooser.components);
          }
        }
      }
      // Add all parallel choosers with the same condition (they appear together)
      for (const c of parallelChooserComponents) {
        c.conditional = { hide: `= ${key} != "${ch.value}"` };
        components.push(c);
      }
    } // AND with no XOR/OR branches: nothing to render
  }

  // Collect leaf tasks (non-gateway choices) for text placeholders
  // These are used when no chooser UI is needed (e.g., for display text)
  const options = choices
    .filter(v => !(v._type || "").includes("Gateway"))
    .map(v => ({ label: v.label, value: v.value }));

  return { components, options };
}





/**
 * Recursively enriches gateway flows with FEEL conditions for cascading XOR gateways.
 * 
 * For XOR gateways, this function writes FEEL conditions to each outgoing flow
 * that check if the form field value matches the target task ID:
 * - Level 1: `= nextTask = "taskId"`
 * - Level 2: `= nextTask_2 = "taskId"`
 * - Level 3: `= nextTask_3 = "taskId"`
 * 
 * The last flow is set as the default (no condition) for determinism.
 * If a target is itself a gateway, this function recursively processes it.
 * 
 * For non-XOR gateways (OR, AND), delegates to `enrichGatewayConditions`.
 * 
 * @param {any} gateway - Gateway element to enrich
 * @param {any} registry - BPMN element registry
 * @param {any} moddle - BPMN moddle factory for creating expressions
 * @param {any} modeling - BPMN modeling service for updating properties
 * @param {number} level - Current nesting level (default: 1)
 * 
 * @example
 * // XOR gateway with 2 flows → TaskA, TaskB
 * // Flow to TaskA: condition `= nextTask = "TaskA"`
 * // Flow to TaskB: default (no condition)
 */
function enrichGatewayConditionsRecursive(gateway, registry, moddle, modeling, level = 1) {
  const outs = gateway.outgoing || [];
  const kind = gatewayType(gateway);
  const key  = varKeyForLevel(level); // Variable name for this level

  // For non-XOR gateways, use flat mode (no cascading needed)
  if (kind !== "XOR") {
    enrichGatewayConditions(gateway, kind, registry, moddle, modeling);
    return;
  }

  // For XOR gateways, set the last flow as default (no condition)
  // This ensures deterministic behavior when no condition matches
  let defaultFlow = outs.length ? outs[outs.length - 1] : null;
  if (defaultFlow) modeling.updateProperties(gateway, { default: defaultFlow });

  // Write FEEL conditions to each outgoing flow
  for (const sf of outs) {
    const tgt = sf.target;
    const t   = tgt?.businessObject?.$type || tgt?.type || "";

    // Default flow has no condition (taken if no other condition matches)
    if (defaultFlow && sf === defaultFlow) {
      modeling.updateProperties(sf, { conditionExpression: null });
    } else {
      // Non-default flows: write FEEL condition checking form field value
      const value = tgt?.id || "";
      const expr  = `= ${key} = "${value}"`; // e.g., `= nextTask = "TaskA"`
      const ce    = moddle.create("bpmn:FormalExpression", { body: expr, language: "feel" });
      modeling.updateProperties(sf, { conditionExpression: ce });
    }

    // If target is itself a gateway, recursively enrich it (level + 1)
    if (t.includes("Gateway")) {
      enrichGatewayConditionsRecursive(tgt, registry, moddle, modeling, level + 1);
    }
  }
}

/**
 * Builds a multi-select checkbox group for OR (Inclusive) gateways.
 * 
 * OR gateways allow one or more paths to be taken. This function creates
 * a multi-select dropdown (checkbox-like UI) where users can select
 * multiple tasks. The variable name is "nextTasks" (plural).
 * 
 * The function recursively collects all leaf tasks (UserTasks, CallActivities)
 * reachable from the gateway, even if they're nested behind other gateways.
 * 
 * @param {any} gateway - OR gateway element
 * @param {any} registry - BPMN element registry
 * @returns {{components: Array, options: Array}} Chooser components and options
 *   - `components`: Array with single multi-select component
 *   - `options`: Array of all selectable task options
 * 
 * @example
 * // OR gateway → Task1, Gateway → Task2, Task3
 * // Creates: multi-select with options [Task1, Task2, Task3]
 */
function buildOrChooser(gateway, registry) {
  const outs  = gateway.outgoing || [];
  const seen  = new Set(); // Prevent duplicates
  const items = [];

  // Helper to add a task item (avoid duplicates)
  function addItem(el) {
    const id = el?.id;
    if (!id || seen.has(id)) return;
    seen.add(id);
    items.push({ label: labelOf(el, "Next task"), value: id });
  }

  // Collect all selectable tasks from gateway paths
  for (const sf of outs) {
    const tgt = sf.target;
    if (!tgt) continue;
    const typ = tgt?.businessObject?.$type || tgt?.type || "";

    // If target is a gateway, recursively collect all leaf tasks behind it
    if (typ.includes("Gateway")) {
      const leaves = collectUserTasksFromGatewayTarget(tgt, registry);
      for (const leaf of leaves) addItem(leaf);
    } else if (typ === "bpmn:UserTask" || typ === "bpmn:CallActivity" || typ === "bpmn:SubProcess") {
      // Direct task target - add it
      addItem(tgt);
    }
  }

  // Return single multi-select component (no wrapper group)
  return {
    options: items,
    components: [{
      type: "select",
      key: "nextTasks", // Plural variable name for OR gateways
      label: labelOf(gateway, "Please choose"),
      multiple: true,   // Multi-select enables checkbox-like behavior
      validate: { required: true },
      values: items.map(o => ({ label: o.label, value: o.value }))
    }]
  };
}

/**
 * Main dispatcher for building chooser components based on gateway type.
 * 
 * Routes to the appropriate chooser builder:
 * - XOR → Cascading dropdowns (recursive)
 * - OR → Multi-select checkboxes
 * - AND → No chooser (all paths execute)
 * 
 * @param {any} gateway - Gateway element
 * @param {string|null} kind - Gateway type: "XOR", "OR", "AND", or null
 * @param {any} registry - BPMN element registry
 * @returns {{components: Array|null, options: Array}} Chooser components and options
 */
function buildChooserForGateway(gateway, kind, registry) {
  if (kind === "XOR") {
    return buildCascadingChooser(gateway, registry, 1);
  }
  
  if (kind === "OR") {
    return buildOrChooser(gateway, registry);
  }

  // AND / unknown: no chooser needed (all paths execute unconditionally)
  return { options: [], components: null };
}

/**
 * Enriches gateway flows with FEEL conditions (flat mode, non-cascading).
 * 
 * Used for OR gateways and non-cascading XOR gateways. Writes FEEL conditions
 * to each outgoing flow:
 * - XOR: `= nextTask = "taskId"` (single selection)
 * - OR: `= list contains(nextTasks, "taskId")` (multiple selection)
 * - AND: No conditions (all flows execute unconditionally)
 * 
 * For XOR gateways, the last flow is set as default (no condition).
 * 
 * @param {any} gateway - Gateway element to enrich
 * @param {string} kind - Gateway type: "XOR", "OR", "AND"
 * @param {any} registry - BPMN element registry
 * @param {any} moddle - BPMN moddle factory for creating expressions
 * @param {any} modeling - BPMN modeling service for updating properties
 */
function enrichGatewayConditions(gateway, kind, registry, moddle, modeling) {
  const outs = gateway.outgoing || [];

  // AND gateways: all flows execute unconditionally (no conditions needed)
  if (kind === "AND") {
    outs.forEach(sf => modeling.updateProperties(sf, { conditionExpression: null }));
    return;
  }

  // XOR gateways: set last flow as default (no condition)
  let defaultFlow = null;
  if (kind === "XOR" && outs.length) {
    defaultFlow = outs[outs.length - 1];
    modeling.updateProperties(gateway, { default: defaultFlow });
  }

  // Write FEEL conditions to each flow
  for (const sf of outs) {
    // Default flow has no condition
    if (kind === "XOR" && sf === defaultFlow) {
      modeling.updateProperties(sf, { conditionExpression: null });
      continue;
    }
    
    // Non-default flows: write condition checking form field value
    const tgt = sf.target;
    const value = tgt?.id || "";
    const expr =
      kind === "XOR"
        ? `= nextTask = "${value}"`                    // Single selection
        : `= list contains(nextTasks, "${value}")`;    // Multiple selection
    const ce = moddle.create("bpmn:FormalExpression", { body: expr, language: "feel" });
    modeling.updateProperties(sf, { conditionExpression: ce });
  }
}

/* ─────────────── Placeholder replacement & chooser swap ─────────────── */

/**
 * Replaces plain-text placeholders throughout a form JSON structure.
 * 
 * This function performs case-insensitive, whole-word replacement of
 * placeholders anywhere in the form JSON (labels, text content, etc.).
 * It recursively walks the entire form structure.
 * 
 * Supported placeholders:
 * - `ManualServiceNamePlaceholder` → Service name
 * - `ProcessStepPlaceholder` → Current step name
 * - `ProcessDescriptionPlaceholder` → Step description
 * - `NextTaskPlaceholder` / `NextTasksPlaceholder` → Next task text
 * - `ReferencesPlaceholder` → HTML list of reference links
 * 
 * @param {object} formJson - Form JSON object to modify (modified in-place)
 * @param {object} context - Context object with replacement values:
 *   - `serviceName`: Service name
 *   - `stepName`: Step name
 *   - `stepDescription`: Step description
 *   - `nextTaskText`: Next task text (for text placeholders)
 *   - `refsHtml`: HTML for references
 * @param {object} options - Options:
 *   - `forceBlankNextTask`: If true, blank out NextTask text (used when chooser UI exists)
 * @returns {object} Modified form JSON (same object)
 * 
 * @example
 * // Replaces "ManualServiceNamePlaceholder" with "My Service"
 * // Replaces "ProcessStepPlaceholder" with "Review Application"
 */
function replacePlaceholdersInForm(
  formJson,
  context,
  { forceBlankNextTask = false } = {}
) {
  // Case-insensitive whole-word replacement helper
  // Uses word boundaries (\b) to avoid partial matches
  const swapWordCI = (s, word, val) =>
    s.replace(new RegExp(`\\b${word}\\b`, "gi"), val);

  // Main replacement function for a single string
  const swap = (s = "") => {
    // If chooser UI exists, blank out NextTask text placeholders
    const nextTxt = forceBlankNextTask ? "" : (context.nextTaskText || "");
    let out = String(s);

    // Replace all supported placeholders
    out = swapWordCI(out, "ManualServiceNamePlaceholder",   context.serviceName ?? "");
    out = swapWordCI(out, "ProcessStepPlaceholder",         context.stepName ?? "");
    out = swapWordCI(out, "ProcessDescriptionPlaceholder",  context.stepDescription ?? "");
    out = swapWordCI(out, "NextTaskPlaceholder",            nextTxt);
    out = swapWordCI(out, "NextTasksPlaceholder",           nextTxt);
    out = swapWordCI(out, "ReferencesPlaceholder",          context.refsHtml ?? "");

    return out;
  };

  // Recursively walk the form structure
  function walk(node) {
    if (!node || typeof node !== "object") return;

    // Replace placeholders in ALL string properties of this node
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === "string") node[k] = swap(v);
    }

    // Also replace in dropdown option labels (values[].label)
    if (Array.isArray(node.values)) {
      node.values.forEach((opt) => {
        if (opt && typeof opt.label === "string") opt.label = swap(opt.label);
      });
    }

    // Recurse into nested components
    if (Array.isArray(node.components)) node.components.forEach(walk);
  }

  walk(formJson);
  return formJson;
}

/**
 * Finds and replaces/removes NextTask(s)Placeholder tokens with chooser components.
 * 
 * This function performs structural replacement (not just text replacement).
 * It searches for nodes/components that contain "NextTaskPlaceholder" or
 * "NextTasksPlaceholder" tokens and replaces them with actual chooser
 * components (dropdowns, checkboxes) or removes them if no chooser exists.
 * 
 * This is separate from text replacement because it replaces entire nodes,
 * not just text content.
 * 
 * @param {object} formJson - Form JSON object to modify (modified in-place)
 * @param {Array|null} chooserComponentsOrNull - Chooser components to insert,
 *   or null to remove the placeholder node
 * 
 * @example
 * // If template has: { type: "text", text: "NextTaskPlaceholder" }
 * // And chooser exists: [{ type: "select", key: "nextTask", ... }]
 * // Result: Placeholder node is replaced with select component
 */
function applyChooserPlaceholder(formJson, chooserComponentsOrNull) {
  if (!formJson || !Array.isArray(formJson.components)) return;
  
  console.log(`[applyChooserPlaceholder] Called with chooser=${!!chooserComponentsOrNull}, components=${chooserComponentsOrNull?.length || 0}`);

  // Check if a string contains the NextTask placeholder token
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

  // Helper: replace one node with multiple nodes (splice operation)
  function replaceWithMany(list, index, newNodes) {
    list.splice(index, 1, ...newNodes);
  }

  let done = false; // Early exit flag

  // Recursively walk the component tree
  function walk(list) {
    for (let i = 0; i < list.length; i++) {
      const node = list[i];

      // Case 1: This node itself contains the token in any string property
      if (nodeHasToken(node)) {
        console.log(`[applyChooserPlaceholder] Found token in node at index ${i}, replacing=${!!chooserComponentsOrNull}`);
        if (!chooserComponentsOrNull) {
          // No chooser exists - remove the placeholder node
          list.splice(i, 1);
        } else {
          // Replace placeholder node with chooser components
          replaceWithMany(list, i, chooserComponentsOrNull);
        }
        done = true;
        return;
      }

      // Case 2: Container with children - check if any child has the token
      if (node && Array.isArray(node.components)) {
        const hasTokenChild = node.components.some((c) => nodeHasToken(c));
        if (hasTokenChild) {
          // Replace entire container with chooser components (or remove it)
          console.log(`[applyChooserPlaceholder] Found token in child of node at index ${i}, replacing=${!!chooserComponentsOrNull}`);
          if (!chooserComponentsOrNull) {
            list.splice(i, 1);
          } else {
            replaceWithMany(list, i, chooserComponentsOrNull);
          }
          done = true;
          return;
        }
        // Recurse into children
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

/**
 * Replaces ReferencesPlaceholder token with HTML list of reference links.
 * 
 * This function performs structural replacement (not just text replacement).
 * It searches for text nodes containing "ReferencesPlaceholder" and replaces
 * them with HTML `<ul>` lists of links, or removes them if no references exist.
 * 
 * This is separate from text replacement because it replaces entire nodes
 * and generates HTML structure.
 * 
 * @param {object} formJson - Form JSON object to modify (modified in-place)
 * @param {Array} refs - Array of reference objects:
 *   - `name`: Display name (optional)
 *   - `url`: Link URL
 * 
 * @example
 * // If template has: { type: "text", text: "ReferencesPlaceholder" }
 * // And refs = [{ name: "Doc", url: "https://..." }]
 * // Result: { type: "text", text: "<ul><li><a href=...>Doc</a></li></ul>" }
 */
function applyReferencesPlaceholder(formJson, refs) {
  if (!formJson || !Array.isArray(formJson.components)) return;

  // Check if a string contains the ReferencesPlaceholder token
  const isRefToken = (s) => typeof s === 'string' && /\bReferencesPlaceholder\b/i.test(s.trim());

  // HTML escape helper to prevent XSS
  const escape = (str = '') => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // Generate HTML list of links (or empty string if no references)
  const html = Array.isArray(refs) && refs.length
    ? `<ul>` + refs.map(r => {
        const name = escape(r?.name || r?.url || 'Document');
        const url  = escape(r?.url || '#');
        return `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a></li>`;
      }).join('') + `</ul>`
    : '';

  let replaced = false; // Early exit flag

  // Recursively walk the component tree
  function walk(list) {
    for (let i = 0; i < list.length; i++) {
      const node = list[i];

      // Case 1: Standalone text node with the token
      if (node?.type === 'text' && isRefToken(node.text)) {
        if (!html) {
          // No references - remove the node
          list.splice(i, 1);
        } else {
          // Replace with HTML list
          list[i] = { type: 'text', text: html };
        }
        replaced = true;
        return;
      }

      // Case 2: Container that contains a text node with the token
      if (node && Array.isArray(node.components)) {
        const idx = node.components.findIndex(c => c?.type === 'text' && isRefToken(c.text));
        if (idx !== -1) {
          if (!html) {
            // No references - remove the container
            list.splice(i, 1);
          } else {
            // Replace container with a group containing the HTML list
            node.type = 'group';
            node.label = node.label || 'References';
            node.components = [{ type: 'text', text: html }];
          }
          replaced = true;
          return;
        }
        // Recurse into children
        walk(node.components);
        if (replaced) return;
      }
    }
  }

  walk(formJson.components);
}

/* ───────────────────────────── Misc utilities ─────────────────────────── */

/**
 * Ensures a form JSON has the required schema version and type.
 * 
 * Camunda Forms require schemaVersion 4 and type "form" to be valid.
 * This function sets these properties if they're missing.
 * 
 * @param {object} form - Form JSON object to modify (modified in-place)
 */
function ensureSchemaV4(form) {
  if (!form.schemaVersion) form.schemaVersion = 4;
  if (!form.type) form.type = "form";
}

/**
 * Attaches a form definition binding to a BPMN element.
 * 
 * This tells Camunda which form to use for this task at runtime.
 * The form binding is added to the element's extensionElements,
 * which is the standard BPMN extension mechanism.
 * 
 * For UserTasks, also adds zeebe:UserTask extension for Camunda modeler
 * compatibility.
 * 
 * @param {any} node - BPMN element (StartEvent, UserTask, etc.)
 * @param {string} formId - Unique form identifier
 * @param {any} moddle - BPMN moddle factory for creating extension elements
 * @param {any} modeling - BPMN modeling service for updating properties
 */
function attachFormDefinition(node, formId, moddle, modeling) {
  const bo = node.businessObject;
  
  // Get or create extensionElements (BPMN extension mechanism)
  const ext = bo.extensionElements || moddle.create("bpmn:ExtensionElements");
  
  // Remove any existing FormDefinition and UserTask elements to avoid duplicates
  const values = (ext.values || []).filter(v => 
    v.$type !== "zeebe:FormDefinition" && v.$type !== "zeebe:UserTask"
  );

  // Create new form definition with deployment binding
  // "deployment" binding means the form is deployed with the process
  const formDef = moddle.create("zeebe:FormDefinition", {
    formId,
    binding: "deployment"
  });

  // For UserTasks, also add zeebe:UserTask extension for Camunda modeler compatibility
  // This ensures the modeler recognizes the task as a user task
  if (bo.$type === "bpmn:UserTask") {
    const userTaskExt = moddle.create("zeebe:UserTask", {});
    values.push(formDef, userTaskExt);
  } else {
    values.push(formDef);
  }

  // Update the element with the new extension elements
  ext.values = values;
  modeling.updateProperties(node, { extensionElements: ext });
}

/**
 * Builds a human-readable text representation of next tasks.
 * 
 * Used for text placeholders when no chooser UI is needed.
 * Different gateway types use different separators:
 * - AND: Comma-separated (e.g., "Task A, Task B, Task C")
 * - OR: Bullet-separated (e.g., "Task A • Task B • Task C")
 * - XOR: Slash-separated (e.g., "Task A / Task B / Task C")
 * 
 * @param {string} kind - Gateway type: "AND", "OR", "XOR", or null
 * @param {Array} options - Array of task options: `[{label: string, value: string}]`
 * @returns {string} Human-readable text, or empty string if no options
 */
function buildNextTaskText(kind, options) {
  if (!options || !options.length) return "";
  const names = options.map(o => o.label);
  if (kind === "AND") return names.join(", ");   // Parallel: comma-separated
  if (kind === "OR")  return names.join(" • "); // Inclusive: bullet-separated
  return names.join(" / ");                      // Exclusive: slash-separated
}

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * 
 * Converts HTML entities:
 * - `&` → `&amp;`
 * - `<` → `&lt;`
 * - `>` → `&gt;`
 * - `"` → `&quot;`
 * - `'` → `&#039;`
 * 
 * @param {string} str - String to escape
 * @returns {string} HTML-escaped string
 */
function escapeHTML(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Builds an HTML `<ul>` list of reference links.
 * 
 * Each reference is rendered as a `<li><a>` link with proper HTML escaping.
 * Links open in a new tab with security attributes (noopener, noreferrer).
 * 
 * @param {Array} refs - Array of reference objects:
 *   - `name`: Display name (optional, falls back to URL)
 *   - `url`: Link URL
 * @returns {string} HTML list of links, or empty string if no references
 */
function buildReferencesHtml(refs) {
  if (!Array.isArray(refs) || refs.length === 0) return "";
  const items = refs.map((r) => {
    const name = escapeHTML(r?.name || r?.url || "Document");
    const url  = escapeHTML(r?.url || "#");
    return `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a></li>`;
  });
  return `<ul>${items.join("")}</ul>`;
}

/**
 * Fallback function to get step description (returns empty string).
 * 
 * This is a placeholder that can be overridden by the `resolveDescriptions`
 * callback in `generateBundle`. The callback provides enriched descriptions
 * from external sources.
 * 
 * @param {any} node - BPMN element (unused in fallback)
 * @returns {Promise<string>} Empty string (always)
 */
async function getStepDescriptionFallback(/* node */) {
  return "";
}

/**
 * Deep clones an object using JSON serialization.
 * 
 * Simple but effective for plain objects (no functions, dates, etc.).
 * 
 * @param {any} o - Object to clone
 * @returns {any} Deep clone of the object
 */
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

/**
 * Converts a string to a URL-friendly slug.
 * 
 * Transformations:
 * - Trims whitespace
 * - Replaces spaces with hyphens
 * - Removes non-alphanumeric characters (except hyphens and underscores)
 * - Collapses multiple hyphens into one
 * 
 * @param {string} s - String to slugify
 * @returns {string} URL-friendly slug
 * 
 * @example
 * slug("My Process Name") → "My-Process-Name"
 * slug("Task 1!") → "Task-1"
 */
function slug(s) {
  return (s || "")
    .toString()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/-+/g, "-");
}

/**
 * Converts a Date to a compact ISO string format.
 * 
 * Removes hyphens and colons, and truncates milliseconds to seconds:
 * - Input: `2025-10-23T22:45:12.345Z`
 * - Output: `20251023T224512Z`
 * 
 * Used for generating unique form IDs with timestamps.
 * 
 * @param {Date} d - Date object
 * @returns {string} Compact ISO string (e.g., "20251023T224512Z")
 */
function isoCompact(d) {
  const iso = d.toISOString(); // e.g., "2025-10-23T22:45:12.345Z"
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Generates a zero-padded 3-digit ordering number based on node position.
 * 
 * Uses the node's diagram coordinates (x, y) to determine ordering:
 * - Y-coordinate is primary (top to bottom)
 * - X-coordinate is secondary (left to right)
 * - Formula: `(y * 1000 + x) | 0` (integer conversion)
 * - Clamped to 0-999 range
 * 
 * This ensures consistent ordering of forms based on visual layout,
 * which is useful for generating ordered filenames like "001-step.form".
 * 
 * @param {any} node - BPMN element with diagram bounds
 * @returns {string} Zero-padded 3-digit string (e.g., "001", "042", "999")
 */
function zeroPadOrder(node) {
  const y = node.di?.bounds?.y ?? 0; // Y-coordinate (vertical position)
  const x = node.di?.bounds?.x ?? 0; // X-coordinate (horizontal position)
  const ord = (y * 1000 + x) | 0; // Combine Y and X, convert to integer
  return String(Math.max(0, Math.min(999, ord))).padStart(3, "0");
}
