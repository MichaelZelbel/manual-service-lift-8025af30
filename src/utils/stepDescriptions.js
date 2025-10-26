// /src/utils/stepDescriptions.js
// Later, we'll back this by a DB table `step_descriptions`:
// columns: service_id (or name), node_id, step_description (<= 2 sentences), service_description (<= 2 sentences).
// For now, return empty strings gracefully.

export async function getStepDescription(serviceName, node /* { id, businessObject } */) {
  // TODO: replace with DB query; e.g., Supabase table `step_descriptions`.
  // return row?.step_description || ''
  return '';
}

export async function getServiceDescription(serviceName) {
  // TODO: DB query; return short summary for the manual service.
  return '';
}
