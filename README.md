

# **Manual Service Lift** {#manual-service-lift}

### ***Turning manual services into clean Camunda workflows — with a little AI magic.***

 **Version:** Prototype v0.1  
 **Date:** October 2025


## 

## **Summary** {#summary}

The **Manual Service Lift** is a prototype web application built to bridge the gap between unstructured *manual services* and executable *Camunda process workflows.* It automates what used to be an exhausting, Excel-and-email-driven effort into something surprisingly graceful — importing, analyzing, and transforming a client’s Master Data System (MDS) exports and SOP PDFs into structured BPMN processes with ready-to-use Camunda forms.

Think of it as an **AI-assisted assembly line for process modeling**:

* It ingests spreadsheets and PDFs.

* It uses large language models (Claude via Bedrock in production, Anthropic via Lovable Cloud for the prototype) to interpret and order them logically.

* It outputs clean, connected BPMN 2.0 diagrams and matching Camunda Webforms.

While deceptively simple on the surface, the app represents a key enabler in helping subject matter experts (SMEs) at the client’s organization move from *manual* to *managed*, all while maintaining traceability back to the MDS and SOP sources.

---

**Table of Contents**

**[Manual Service Lift	1](#manual-service-lift)**

[Summary	2](#summary)

[Feature Overview	4](#feature-overview)

[Technical Architecture Summary	15](#technical-architecture-summary)

[User Journey / Workflow	17](#user-journey-/-workflow)

[Closing Notes	19](#closing-notes)

[**Appendix	20**](#appendix)

[Appendix A – Gateway Handling and Conditional Forms	20](#appendix-a-–-gateway-handling-and-conditional-forms)

[Appendix B – Unified Template Architecture for Dynamic Form Generation	31](#appendix-b-–-unified-template-architecture-for-dynamic-form-generation)

[Appendix C – BPMN-JS Library	39](#appendix-c-–-bpmn-js-library)

[Todos	44](#todos)

## 

## **Feature Overview** {#feature-overview}

### **1\. Manual Service Converter**

The **Manual Service Converter** is where the transformation begins.  
 An **administrator** uploads an MDS spreadsheet (Excel /CSV) listing subprocesses or manual service steps. Each step links to one or more PDF SOPs and optionally Decision Sheets.

From there, the app:

* Parses and **orders steps intelligently** using an LLM to ensure logical process flow.

* Extracts **major SOP actions** (not low-level details) and turns them into subprocess BPMN models.

* Persists the AI-generated versions in the database while allowing users to rearrange them visually or in list form.

* Keeps the original AI-generated baseline untouched — users can always reset back to it.

* Lets users open any step’s subprocess for the same visual or list-based editing.

Each manual service tile on the overview page displays:

* Manual Service Name (from MDS)

* Performing Team

* Service Performer Organization

* Timestamps for: Last Edit, Last BPMN Export, Last Form Export, and Last Backend Analysis

Each tile includes shortcuts to:

* **Edit Process** (list and BPMN views)

* **Export BPMN & Forms**

* **Backend Analysis**

---

### 

### **2\. Basic Forms Generator**

The **Basic Forms Generator** automates the creation of simple, consistent **Camunda 8 webforms** — the kind of forms SMEs would otherwise spend days designing by hand.  
 It transforms every **Manual Service process** and its **user tasks** into ready-to-deploy Camunda forms that link directly to their respective BPMN nodes.

#### **2.1 Template-Driven Generation**

Form generation is **template-based**, ensuring that all generated webforms share a consistent structure, layout, and visual language.

Instead of maintaining four separate templates for every path combination, the system uses **two universal templates**, each dynamically adapted to the BPMN topology:

| Template | Purpose | Source Filename |
| ----- | ----- | ----- |
| **Start Node Form Template** | Used for the process start node of the Manual Service. This template typically contains field for collecting data that are only needed at the start of a proces. | `start-node.form` |
| **Task Node Form Template** | Used for all user task nodes within the Manual Service process. This template typically contains a placeholder for references to SOPs and other supporting documents | `task-node.form` |

Both templates can be updated by the administrator.

At generation time, the application automatically uses these templates and replaces the placeholders inside them with live context data extracted from the BPMN and SOP/MDS information.

---

#### **2.2 Placeholder Replacement**

Each template contains placeholders that are dynamically replaced with context data from the current process.  
 During generation, the following fields are substituted:

| Placeholder | Replacement |
| ----- | ----- |
| **ManualServiceNamePlaceholder** | The manual service’s name (from the MDS import) |
| **ProcessStepPlaceholder** | The process step’s name (from the MDS import) |
| **ProcessDescriptionPlaceholder** | A brief summary derived from the SOP text of the subprocess |
| **NextTaskPlaceholder** | A chooser element for the user to select from the next possible user tasks. The placeholder will simply be removed if the next user task(s) are fixed. |
| **ReferencesPlaceholder** | PDF Filenames and links, e.g. SOPs, Decision Sheets, and Navigation Sheets (from the MDS import) |

#### **Automatic Template Adaptation for Paths**

When a form is generated, the template’s placeholder group  
 `id: "NextTaskChooserPlaceholder"`  
 is replaced by the appropriate “chooser” elements depending on the node’s outgoing sequence flow:

| BPMN Topology | Inserted UI Element | Behavior |
| ----- | ----- | ----- |
| **Single Path / Parallel Gateway** | *(none)* | The placeholder is removed entirely since the next steps are predetermined. |
| **Exclusive Gateway (XOR)** | **Dropdown** | Lets the user select exactly one next task from multiple options. |
| **Inclusive Gateway (OR)** | **Checkbox Group** | Lets the user select one or more applicable next tasks. |
| **Cascading Gateways** | **Conditional Dropdowns** *(future enhancement)* | Additional choosers may appear dynamically depending on earlier selections. |

#### **2.3 Filename and Form ID Convention**

Each form file receives a clear, zero-padded, position-based filename reflecting its order in the process:

| Example | Meaning |
| ----- | ----- |
| `000-start.form` | The Start node’s form |
| `001-VerifyCustomerIdentity.form` | The first user task’s form |
| `002-ReviewDocuments.form` | The next user task’s form |

To ensure stable linking between BPMN nodes and their forms, each form is assigned a **unique `formId`**, built as:

\<formFileNameWithoutExtension\>-\<UTCtimestamp\>

Example:  
 `001-VerifyCustomerIdentity-20251022T104512`

This same `formId` is written into both:

* The `"id"` field of the generated form JSON

* And the BPMN node’s `zeebe:formDefinition` element:

\<bpmn:userTask id="UserTask\_1" name="Verify Customer Identity"\>

  \<bpmn:extensionElements\>

    \<zeebe:formDefinition formId="001-VerifyCustomerIdentity-20251022T104512" bindingType="deployment" /\>

    \<zeebe:userTask /\>

  \</bpmn:extensionElements\>

\</bpmn:userTask\>

For the start event, the form is linked in the same way:

\<bpmn:startEvent id="StartEvent\_1" name="Start"\>

  \<bpmn:extensionElements\>

    \<zeebe:formDefinition formId="000-start-20251022T104512" bindingType="deployment" /\>

  \</bpmn:extensionElements\>

\</bpmn:startEvent\>

This **formId symmetry** guarantees that when the bundle is deployed to Camunda 8, each node automatically uses its correct form.

#### **2.4 Form JSON Schema**

Generated forms conform to Camunda’s JSON structure (schemaVersion 4):

{

  "schemaVersion": 4,

  "type": "form",

  "id": "001-VerifyCustomerIdentity-20251022T104512",

  "components": \[ ... \]

}

The content of `components` is cloned from the corresponding template, with placeholders replaced by live values.

#### **2.5 Output Packaging**

When the user clicks **“Download for Camunda”**, the generator:

1. Loads the current edited BPMN (`edited_bpmn_xml` or fallback to `original_bpmn_xml`).

2. Produces one `.form` per **start event** and **user task**, using the correct template and filename.

3. Injects the new `zeebe:formDefinition` entries into the BPMN XML.

4. Creates a manifest:

{

  "service": "Handle Loan Application",

  "generatedAt": "2025-10-22T10:45:12Z",

  "forms": \[

    {

      "nodeId": "StartEvent\_1",

      "name": "Start",

      "filename": "000-start.form",

      "formId": "000-start-20251022T104512"

    },

    {

      "nodeId": "UserTask\_1",

      "name": "Verify Customer Identity",

      "filename": "001-VerifyCustomerIdentity.form",

      "formId": "001-VerifyCustomerIdentity-20251022T104512"

    }

  \]

}

5. Packages everything into a ZIP containing:

   * The updated `manual-service.bpmn`

   * All `.form` files

   * The manifest

This ZIP is **ready for direct deployment** into Camunda 8, where each form binds automatically to its corresponding node via its formId.

#### **2.6 Linking Mode**

The prototype uses the **`bindingType="deployment"`** setting to ensure that every generated bundle remains self-contained and deploys consistently without dependency on older form versions.  
 (If required for production, this can be toggled to `"latest"` to always use the newest form revision.)

#### **2.7 Versioning and Reusability**

All templates remain version-controlled and reusable:

* In the prototype, they are stored in Lovable’s Supabase storage bucket.

* In production, they will be hosted in a **Git-backed repository** to support version history, pull-based updates, and collaborative template design.

### **2.8 Conditional Gateways and Dynamic Form Generation**

While basic forms handle straightforward user tasks, many real-world processes require **conditional next steps**.  
 In these cases, user tasks are followed by gateways (exclusive, inclusive, or parallel) that determine which subsequent tasks are created after form submission.

Our prototype system automatically analyzes these gateways and enriches both the **BPMN** and **form JSON** accordingly:

* **Forms** collect user decisions using dropdowns, checkboxes, or conditional elements.

* **Gateways** evaluate these variables using **FEEL expressions** to decide which sequence flows (and therefore which tasks) to activate.

For detailed logic, implementation steps, and code examples, see **Appendix A – Gateway Handling and Conditional Forms**.

---

### 

### **3\. Backend Analyzer**

The **Backend Analyzer** is where AI plays the role of automation scout.  
 It reviews SOPs, BPMN diagrams, and any uploaded API catalogs to identify **automation opportunities** — producing a “Change Report” (CR) that flags:

* Which user tasks could be automated.

* Which APIs might support the automation.

* Suggested data payload structures (e.g., JSON schemas).

While the prototype uses purely generative outputs (mock data, synthetic APIs), the architecture is designed to later integrate real catalogs for live backend assessments.

---

### **4\. User Roles and Access**

The prototype implements a light, controlled access layer.  
 On login, users authenticate with their **B-Number** and password — no signup, no fuss.

| User | Role | B-Number | Password |
| ----- | ----- | ----- | ----- |
| Alice | Admin | BH1111 | Dell@123 |
| Bob | User | BH2222 | Dell@123 |
| Mallory | User | BH3333 | Dell@123 |

After login, users see their name in the top bar and access their permitted features.

* **Admins** can upload data, templates, and API catalogs.

* **Users** can edit, reorder, and export processes but not upload system-level data.

The prototype deliberately skips record-locking — simultaneous edits simply overwrite one another, because this is a fast prototype, not an enterprise CMS (yet).

---

## **Technical Architecture Summary** {#technical-architecture-summary}

The **Manual Service Lift** is designed as a **microservices-based web application** running in Lovable Cloud for the prototype and AWS EC2 / Bedrock in production.  
 Each of the three main features is implemented as an independent service communicating via RESTful APIs.

### **Architecture Components**

| Component | Purpose | Prototype Technology |
| ----- | ----- | ----- |
| **Frontend Web App** | User interface for admins and users | Lovable Framework (Next.js under the hood) |
| **Manual Service Converter Service** | Imports MDS data, parses SOPs, orchestrates LLM-based ordering | Supabase \+ Anthropic Claude API |
| **Basic Forms Generator Service** | Generates Camunda form JSONs from templates | Node microservice with template parser |
| **Backend Analyzer Service** | Identifies automation opportunities and generates CRs | LLM-based service (Claude), mock API data |
| **Database** | Persists MDS data, user edits, process versions | Supabase (PostgreSQL) |
| **Auth Layer** | Simple login system (B-Number \+ password) | Lovable Auth |
| **File Storage** | SOPs, Decision Sheets, templates | Supabase file storage |
| **LLM Engine** | AI processing | Anthropic Claude (via Lovable Cloud); Bedrock in production |
| **Future Integration Target** | Downstream system | Camunda API (Staging environment) |

Security principles follow a **zero-trust model**, with token-based authentication for internal service calls and role-based permissions for users.

---

## 

## **User Journey / Workflow** {#user-journey-/-workflow}

### **Step 1: Login**

User opens the app, enters B-Number and password.  
 Admins and users land on the same dashboard but see different options.

### **Step 2: Overview of Manual Services**

The dashboard lists all manual services imported from MDS — each displayed as a clickable tile.  
 Users can:

* Filter dynamically at the top of the page.

* Browse via pagination.

* Check timestamps for edits, exports, and analyses.

### **Step 3: Editing a Manual Service**

Clicking a tile opens the **List Editor View** — a vertical list of steps and gates with their connections.  
 Users can:

* Reorder steps (drag & drop).

* Inspect connections (via pop-ups).

* Open the **Graphical BPMN Editor** (powered by bpmn-js) to adjust flow and gateways.

For subprocesses, users can:

* Add or delete steps.

* Rearrange connections visually.  
   All edits auto-save in the backend.

A **“Reset to AI Version”** button lets users discard all edits and restore the LLM-generated baseline.

### **Step 4: Exporting**

Once satisfied, the user can click **Export BPMN & Forms**.  
 The app:

1. Generates BPMN 2.0 diagrams (reformatted for clarity and minimal line overlaps).

2. Auto-links main process steps to their subprocess BPMNs.

3. Generates Camunda webforms (JSON) from the four templates.

4. Offers download links for BPMN and form packages.

For any step without an SOP or manual additions, a minimal start–end BPMN stub is generated automatically.

### **Step 5: Backend Analysis**

The user can trigger **Backend Analysis** from the same tile.  
 The app runs an LLM-based review of the service and its subprocesses, returning a **Change Report (CR)** with:

* Suggested automation points.

* API calls and payloads.

* Mock “effort savings” or “automation readiness” metrics.

The CR is downloadable as a PDF summary.

---

## 

## **Closing Notes** {#closing-notes}

The **Manual Service Lift** prototype is equal parts proof of concept and future foundation.  
 It shows that the transition from manual documentation to executable process can be **AI-assisted, structured, and fast**, without losing the human insight of SMEs.

Lovable Cloud hosts the first working prototype.  
 Supabase keeps the data tidy.  
 Claude makes the processes make sense.  
 And someday soon, Camunda will just *receive* perfectly packaged workflows from this app — as if by magic (but we’ll know it’s Michael’s architecture behind the curtain).

---

Would you like me to add a short **“Glossary of Terms”** section at the end (for MDS, SOP, BPMN, etc.) to make it even more self-contained for client-side readers?

# 

# Appendix {#appendix}

## **Appendix A – Gateway Handling and Conditional Forms** {#appendix-a-–-gateway-handling-and-conditional-forms}

### **A.1 Overview**

Camunda 8 separates **user interactions (forms)** from **process routing (gateways)**.  
 Forms collect data; BPMN gateways evaluate conditions written in the **FEEL** expression language.  
 Our generator bridges both sides automatically by:

1. Detecting which type of gateway follows each user task.

2. Injecting the correct input components into the generated form (dropdown, checkbox group, etc.).

3. Writing matching **FEEL conditions** into the outgoing sequence flows of the gateway.

The result: when an SME models a process visually, the system ensures that all decision points are both executable and measurable.

---

### 

### **A.2 Gateway Types and Matching Form Elements**

| Gateway Type | Typical Logic | Form Element | Variable | Example FEEL Expression |
| ----- | ----- | ----- | ----- | ----- |
| **Exclusive (XOR)** | One of several paths | Dropdown or radio buttons | `nextTask` *(string)* | `= nextTask = "KYC_CHECK"` |
| **Inclusive (OR)** | One or more paths | Checkbox group | `nextTasks` *(list)* | `= list contains(nextTasks, "SEND_SMS")` |
| **Parallel (AND)** | All paths | No chooser (just a submit button) | — | *(no condition)* |

Each generated form collects only the data required by the following gateway.

---

### **A.3 Example: Exclusive Choice**

#### **A.3.1 Form JSON**

`{`

  `"schemaVersion": 3,`

  `"type": "default",`

  `"id": "001-VerifyCustomerIdentity",`

  `"components": [`

    `{`

      `"type": "select",`

      `"label": "Choose the next task",`

      `"key": "nextTask",`

      `"validate": { "required": true },`

      `"values": [`

        `{ "label": "KYC Check", "value": "KYC_CHECK" },`

        `{ "label": "Address Update", "value": "ADDRESS_UPDATE" },`

        `{ "label": "Close Account", "value": "CLOSE_ACCOUNT" }`

      `]`

    `},`

    `{ "type": "button", "label": "Continue", "action": "submit" }`

  `]`

`}`

#### **A.3.2 BPMN Snippet**

`<bpmn:exclusiveGateway id="Gateway_1" default="Flow_default" />`

`<bpmn:sequenceFlow id="Flow_kyc" sourceRef="Gateway_1" targetRef="Task_KYC">`

  `<bpmn:conditionExpression language="feel">= nextTask = "KYC_CHECK"</bpmn:conditionExpression>`

`</bpmn:sequenceFlow>`

`<bpmn:sequenceFlow id="Flow_addr" sourceRef="Gateway_1" targetRef="Task_Address">`

  `<bpmn:conditionExpression language="feel">= nextTask = "ADDRESS_UPDATE"</bpmn:conditionExpression>`

`</bpmn:sequenceFlow>`

`<bpmn:sequenceFlow id="Flow_default" sourceRef="Gateway_1" targetRef="Task_Default" />`

---

### **A.4 Example: Inclusive Choice**

#### **A.4.1 Form JSON**

`{`

  `"schemaVersion": 3,`

  `"type": "default",`

  `"id": "002-FollowUpTasks",`

  `"components": [`

    `{`

      `"type": "checkbox-group",`

      `"label": "Select all next tasks that apply",`

      `"key": "nextTasks",`

      `"validate": { "required": true },`

      `"values": [`

        `{ "label": "Send SMS", "value": "SEND_SMS" },`

        `{ "label": "Open Ticket", "value": "OPEN_TICKET" },`

        `{ "label": "Email Customer", "value": "EMAIL_CUSTOMER" }`

      `]`

    `},`

    `{ "type": "button", "label": "Continue", "action": "submit" }`

  `]`

`}`

#### **A.4.2 BPMN Snippet**

`<bpmn:inclusiveGateway id="Gateway_OR" />`

`<bpmn:sequenceFlow id="Flow_sms" sourceRef="Gateway_OR" targetRef="Task_SMS">`

  `<bpmn:conditionExpression language="feel">= list contains(nextTasks, "SEND_SMS")</bpmn:conditionExpression>`

`</bpmn:sequenceFlow>`

`<bpmn:sequenceFlow id="Flow_ticket" sourceRef="Gateway_OR" targetRef="Task_Ticket">`

  `<bpmn:conditionExpression language="feel">= list contains(nextTasks, "OPEN_TICKET")</bpmn:conditionExpression>`

`</bpmn:sequenceFlow>`

---

### **A.5 Example: Parallel Execution**

When all next steps are mandatory, the form has no chooser.

#### **A.5.1 Form JSON**

`{`

  `"schemaVersion": 3,`

  `"type": "default",`

  `"components": [`

    `{ "type": "button", "label": "Continue", "action": "submit" }`

  `]`

`}`

#### **A.5.2 BPMN Snippet**

`<bpmn:parallelGateway id="Gateway_AND" />`

`<bpmn:sequenceFlow id="Flow_1" sourceRef="Gateway_AND" targetRef="Task_A" />`

`<bpmn:sequenceFlow id="Flow_2" sourceRef="Gateway_AND" targetRef="Task_B" />`

---

### **A.6 Cascading Gateways and Conditional UI Elements**

Sometimes one user task leads to a **cascade** of gateways — e.g., an exclusive choice that itself leads to another decision point.  
 In such cases, the generator can nest conditional form elements that appear only when relevant.

#### **A.6.1 Example: Conditional Sub-Choice**

`{`

  `"schemaVersion": 3,`

  `"type": "default",`

  `"components": [`

    `{`

      `"type": "select",`

      `"key": "nextTask",`

      `"label": "Choose next step",`

      `"values": [`

        `{"label":"KYC Check","value":"KYC_CHECK"},`

        `{"label":"Route to downstream gateway","value":"ROUTE_TO_SUBGW"}`

      `]`

    `},`

    `{`

      `"type": "select",`

      `"key": "subRoute",`

      `"label": "Refine route",`

      `"values": [`

        `{"label":"Enhanced Due Diligence","value":"EDD"},`

        `{"label":"Simplified Due Diligence","value":"SDD"}`

      `],`

      `"conditional": { "hide": "= nextTask != \"ROUTE_TO_SUBGW\"" }`

    `},`

    `{ "type": "button", "label": "Continue", "action": "submit" }`

  `]`

`}`

**Explanation:**

* The second dropdown only appears when the user selects *Route to downstream gateway*.

* Both variables (`nextTask` and `subRoute`) are submitted at once.

* The BPMN then uses `nextTask` for the first gateway and `subRoute` for the second.

---

### **A.7 How the Generator Implements This**

#### **Step 1 — Traverse the BPMN**

The application uses **bpmn-js** to read the process graph:

* For each user task, it identifies whether the next element is a gateway.

* For each gateway, it collects the outgoing paths and resolves the names/IDs of target user tasks.

#### **Step 2 — Build Form Components**

Depending on the gateway type:

* **Exclusive (XOR):** add a select element writing `nextTask`.

* **Inclusive (OR):** add a checkbox-group writing `nextTasks`.

* **Parallel (AND):** skip chooser, only include submit button.

* **Cascades:** if one path leads to another gateway, add an additional conditional chooser.

#### **Step 3 — Enrich BPMN**

For each outgoing sequence flow:

* **XOR:** `<bpmn:conditionExpression language="feel">= nextTask = "VALUE"</bpmn:conditionExpression>`  
   (Mark one default flow without condition.)

* **OR:** `<bpmn:conditionExpression language="feel">= list contains(nextTasks, "VALUE")</bpmn:conditionExpression>`

* **AND:** no condition.

#### **Step 4 — Output Consistency**

All forms and BPMN updates are written to the export ZIP.  
 Each flow variable name, gateway condition, and form field key align automatically, guaranteeing Camunda 8 executes the process exactly as the SME modeled it.

---

### **A.8 Algorithm Sketch**

`for (let userTask of model.userTasks()) {`

  `const next = userTask.nextNode();`

  `if (!isGateway(next)) continue;`

  `const type = gatewayType(next); // XOR | OR | AND`

  `const options = next.outgoing.map(flow => ({`

    `label: resolveToUserTask(flow.target).name,`

    `value: resolveToUserTask(flow.target).id`

  `}));`

  `// Create form inputs`

  `if (type === 'XOR') addSelect(form, 'nextTask', options);`

  `if (type === 'OR') addCheckboxGroup(form, 'nextTasks', options);`

  `if (type === 'AND') addSubmitOnly(form);`

  `// Enrich BPMN`

  `for (let flow of next.outgoing) {`

    `const value = resolveToUserTask(flow.target).id;`

    ``if (type === 'XOR') setFeel(flow, `= nextTask = "${value}"`);``

    ``if (type === 'OR') setFeel(flow, `= list contains(nextTasks, "${value}")`);``

  `}`

  `if (type === 'XOR') markOneDefault(next); // remove its condition`

`}`

---

### **A.9 Key Takeaways**

* **Forms never create tasks** — BPMN gateways do.

* **Forms only set variables**, and those variables are evaluated by **FEEL conditions** on the sequence flows.

* **Every gateway type** corresponds to a predictable form pattern.

* **Conditional UI logic** allows cascading decision structures.

* **Automatic enrichment** ensures SMEs can model visually while the system guarantees executable correctness.

## 

## **Appendix B – Unified Template Architecture for Dynamic Form Generation** {#appendix-b-–-unified-template-architecture-for-dynamic-form-generation}

### **B.1 Overview**

Earlier versions of the prototype used **two templates per node position** — one with a next-task chooser and one without.  
 While functional, this duplication made maintenance cumbersome and restricted flexibility when introducing new chooser types such as checkbox groups or cascaded dropdowns.

To simplify template management and improve adaptability, the recommended approach is to move to a **single template per node position** (one for *First Step* and one for *Next Step*), with a **dedicated placeholder** that the generator dynamically replaces with the appropriate chooser element(s) — or removes entirely when not needed.

---

### **B.2 Concept**

Each base template includes a **placeholder component** named  
 `NextTaskChooserPlaceholder`.  
 At generation time, the algorithm evaluates the BPMN topology and replaces this placeholder according to the detected gateway type:

| Gateway Type | Replacement in Placeholder | Variable Written | Condition Type in BPMN |
| ----- | ----- | ----- | ----- |
| **Exclusive (XOR)** | Single-select dropdown / radio group | `nextTask` *(string)* | `= nextTask = "VALUE"` |
| **Inclusive (OR)** | Checkbox group | `nextTasks` *(list)* | `= list contains(nextTasks, "VALUE")` |
| **Parallel (AND)** | Placeholder removed (no chooser) | — | *(no condition)* |
| **Cascade** | Multiple nested components with `conditional.hide` FEEL expressions | `nextTask`, `subRoute`, etc. | Multi-level FEEL |

This approach centralizes layout control while allowing infinite expansion of chooser logic.

---

### **B.3 Base Template Example**

**Next Step Base Template**

`{`

  `"schemaVersion": 4,`

  `"type": "form",`

  `"id": "NextStep-<ID>",`

  `"components": [`

    `{ "type": "text", "text": "Process: {{ManualServiceNamePlaceholder}}" },`

    `{ "type": "text", "text": "Step: {{ProcessStepPlaceholder}}" },`

    `{`

      `"type": "group",`

      `"id": "NextTaskChooserPlaceholder",`

      `"label": "Next step(s)",`

      `"components": [`

        `{ "type": "text", "text": "NextTaskChooserPlaceholder" }`

      `]`

    `},`

    `{ "type": "divider" },`

    `{ "type": "button", "action": "submit", "label": "Continue" }`

  `]`

`}`

This placeholder group is the only element that changes per node.  
 All other components (headings, references, traceability fields, etc.) remain consistent across every generated form.

---

### **B.4 Dynamic Replacements**

#### **B.4.1 Exclusive (XOR)**

`{`

  `"type": "select",`

  `"key": "nextTask",`

  `"label": "Choose the next task",`

  `"validate": { "required": true },`

  `"values": [`

    `{ "label": "KYC Check", "value": "Task_KYC" },`

    `{ "label": "Address Update", "value": "Task_Address" },`

    `{ "label": "Route to sub-gateway", "value": "ROUTE_TO_SUBGW" }`

  `]`

`}`

#### **B.4.2 Inclusive (OR)**

`{`

  `"type": "checkbox-group",`

  `"key": "nextTasks",`

  `"label": "Select all next tasks that apply",`

  `"validate": { "required": true },`

  `"values": [`

    `{ "label": "Send SMS", "value": "Task_SMS" },`

    `{ "label": "Open Ticket", "value": "Task_Ticket" },`

    `{ "label": "Email Customer", "value": "Task_Email" }`

  `]`

`}`

#### **B.4.3 Parallel (AND)**

The placeholder group is **removed**.  
 The form will only contain the submit button.

#### **B.4.4 Cascade (Conditional Chooser)**

`{`

  `"type": "group",`

  `"label": "Next step(s)",`

  `"components": [`

    `{`

      `"type": "select",`

      `"key": "nextTask",`

      `"label": "Choose next step",`

      `"values": [`

        `{"label":"KYC Check","value":"KYC_CHECK"},`

        `{"label":"Route to downstream gateway","value":"ROUTE_TO_SUBGW"}`

      `]`

    `},`

    `{`

      `"type": "select",`

      `"key": "subRoute",`

      `"label": "Refine route",`

      `"values": [`

        `{"label":"Enhanced Due Diligence","value":"EDD"},`

        `{"label":"Simplified Due Diligence","value":"SDD"}`

      `],`

      `"conditional": { "hide": "= nextTask != \"ROUTE_TO_SUBGW\"" }`

    `}`

  `]`

`}`

---

### **B.5 Replacement Algorithm**

1. **Locate Placeholder:**  
    Find the component whose `id` \= `NextTaskChooserPlaceholder`.

2. **Determine Gateway Type:**  
    Using *bpmn-js*, inspect the next element after the current user task.

3. **Generate Chooser Components:**

   * *XOR* → create `select` element.

   * *OR* → create `checkbox-group`.

   * *AND* → no chooser (set to `null`).

   * *Cascade* → stack of components with `conditional.hide` expressions.

**Apply Replacement:**

 `function applyChooser(template, chooserComponentsOrNull) {`

  `const i = template.components.findIndex(c => c.id === "NextTaskChooserPlaceholder");`

  `if (i === -1) return template;`

  `if (!chooserComponentsOrNull) template.components.splice(i, 1);`

  `else template.components[i].components = chooserComponentsOrNull;`

  `return template;`

`}`

4.   
5. **Update BPMN Sequence Flows:**

   * **XOR:** add `<bpmn:conditionExpression language="feel">= nextTask = "VALUE"</bpmn:conditionExpression>` to non-default flows.

   * **OR:** add `<bpmn:conditionExpression language="feel">= list contains(nextTasks, "VALUE")</bpmn:conditionExpression>` to all flows.

   * **AND:** no conditions.

---

### **B.6 Benefits**

* **Minimal Maintenance:** only two templates to update.

* **Consistent Layout:** identical styling for all generated forms.

* **Extensible:** supports new chooser types without new templates.

* **Safe Defaults:** if the placeholder is not replaced, the text component acts as a harmless fallback.

* **Future-proof:** allows for DMN-driven or dynamically populated choosers later on.

---

### **B.7 Implementation Summary**

| Step | Responsibility | Output |
| ----- | ----- | ----- |
| 1 | Parse BPMN graph | Identify gateway type and next tasks |
| 2 | Clone base template | `NextTaskChooserPlaceholder` present |
| 3 | Replace or remove placeholder | Inject chooser components |
| 4 | Add FEEL expressions | Update sequence flow conditions |
| 5 | Export bundle | BPMN \+ all forms ready for deployment |

---

### **B.8 Conclusion**

Switching to a **unified template design** streamlines the generator’s logic and keeps future enhancements (like cascades, dynamic data sources, or multilingual text) simple.  
 Instead of maintaining multiple template variants, the system now relies on one smart placeholder per form type — a single, elegant entry point for all gateway-driven dynamic behavior.

## 

## **Appendix C – BPMN-JS Library** {#appendix-c-–-bpmn-js-library}

### **Overview**

**BPMN-JS** is an open-source JavaScript toolkit developed by [bpmn.io](https://bpmn.io/) for viewing, editing, and programmatically working with **BPMN 2.0 process diagrams** directly in the browser.  
 It provides a complete rendering and modeling engine that reads and writes BPMN XML while preserving all BPMN semantics.

In the context of **Manual Service Lift**, BPMN-JS is the **core engine** that powers everything related to process diagrams:

* loading and displaying existing BPMN models,

* letting Subject-Matter Experts (SMEs) edit and refine them visually,

* parsing and traversing the BPMN graph for form generation and enrichment, and

* exporting valid, executable BPMN 2.0 XML files for Camunda 8\.

---

### **Why BPMN-JS Is Used**

The prototype’s goal is to make AI-assisted process automation **accessible to business users**, not just technical modelers.  
 BPMN-JS was chosen because it provides:

| Capability | Why It Matters in Manual Service Lift |
| ----- | ----- |
| **Browser-native rendering** | Processes can be created and visualized directly in the web app without any external modeling tools such as Camunda Modeler. |
| **Full BPMN 2.0 compliance** | Ensures every diagram created in the prototype can be deployed to Camunda 8 without manual corrections. |
| **Extensible data model (moddle)** | Allows the application to read and write custom extensions like `zeebe:formDefinition` and FEEL conditions for gateways. |
| **Fine-grained graph traversal** | Enables our generator to analyze sequence flows, detect gateways, and automatically decide where dropdowns or checkboxes appear in forms. |
| **Serialization / Deserialization** | Converts between in-memory diagrams and BPMN XML — essential for packaging the ZIP exports. |
| **Plugin architecture** | Makes it possible to later add custom modeling behavior, validation rules, or AI-based diagram suggestions. |

Without BPMN-JS, the app would either have to rely on static BPMN files uploaded by users or integrate Camunda Modeler itself — both approaches would break the “instant modeling in the browser” experience.

---

### **How BPMN-JS Is Used in the Prototype**

Manual Service Lift uses BPMN-JS in **two distinct ways**:

#### **1\. Interactive Editor (Visible)**

In the Manual Service modeling screen, BPMN-JS powers the canvas that allows SMEs to:

* import a BPMN diagram from MDS data,

* rearrange nodes and gateways visually,

* rename tasks, and

* save the edited model.

This is achieved through a BPMN-JS **Modeler** instance created with:

import BpmnJS from 'bpmn-js/lib/Modeler';

const modeler \= new BpmnJS({ container: '\#canvas' });

User actions in the editor directly manipulate the BPMN graph inside this modeler.

#### **2\. Headless Modeler (Invisible)**

During export, a **headless BPMN-JS instance** runs behind the scenes:

* It loads the latest BPMN XML for the Manual Service.

* The generator module (`formgen-core.js`) uses the BPMN-JS API to:

  * traverse sequence flows,

  * identify gateways and user tasks,

  * add `zeebe:formDefinition` extensions,

  * inject FEEL expressions into sequence flows, and

  * finally serialize the enriched diagram back to XML.

This ensures the exported process is both **syntactically correct** and **semantically complete** for Camunda 8 deployment.

Example of saving enriched XML:

const { xml } \= await bpmnModeler.saveXML({ format: true });

---

### **BPMN-JS Components in Use**

| Component | Role in Manual Service Lift |
| ----- | ----- |
| `BpmnJS` (`lib/Modeler`) | Full-featured modeler for visual editing and export generation. |
| `elementRegistry` | Accesses all nodes in the diagram to identify Start Events, User Tasks, and Gateways. |
| `moddle` | Creates and manages BPMN and Zeebe extension elements (`zeebe:FormDefinition`, `bpmn:FormalExpression`). |
| `modeling` | Programmatically updates diagram properties (e.g., assigning form bindings or conditions). |
| `saveXML()` / `importXML()` | Serializes and deserializes BPMN XML. |

---

### **Integration with Other Modules**

* The **Form Generation Module** (`formgen-core.js`) calls BPMN-JS to traverse the process and write extensions directly into the diagram.

* The **Export Module** uses BPMN-JS to ensure that what users download as `manual-service.bpmn` is fully compliant BPMN 2.0 XML.

* The **Lovable UI** initializes a BPMN-JS modeler whenever a process needs to be viewed or edited, using the same library both visually and headlessly — guaranteeing consistency between what users see and what gets exported.

---

### **Key Takeaways**

* **BPMN-JS** is the backbone for all process-diagram operations in Manual Service Lift.

* It ensures **visual editing, semantic correctness, and Camunda-ready exports** all come from the same trusted engine.

* The app uses BPMN-JS both **interactively** (in the editor) and **programmatically** (during form generation and export).

* This dual use guarantees that every Manual Service diagram a user sees and every BPMN file they download are technically identical.

---

Would you like me to also include a short visual diagram (in Mermaid or text form) showing how *BPMN-JS*, *formgen-core*, and the *Export UI* interact? It would make Appendix C even clearer for non-technical readers.

## 

## **Todos** {#todos}

**Add the following points**

* Merge with **User Manual?**  
* **Candidate Groups** are editable via the properties panel and persist in XML as `camunda:candidateGroups`.  
* **User Tasks**, expose **Candidate Groups** (string, comma-separated) mapped to `camunda:candidateGroups`.

