// /src/utils/stepDescriptions.js
import { fetchStepDescription, fetchServiceDescription } from '@/integrations/supabase/descriptions';

/**
 * Get step description from database
 * @param {string} serviceName - The service key (manual service name)
 * @param {Object} node - The BPMN node { id, businessObject }
 * @returns {Promise<string>} The step description (≤2 sentences)
 */
export async function getStepDescription(serviceName, node) {
  if (!serviceName || !node?.id) return '';
  return await fetchStepDescription(serviceName, node.id);
}

/**
 * Get service-level description from database
 * @param {string} serviceName - The service key (manual service name)
 * @returns {Promise<string>} The service description (≤2 sentences)
 */
export async function getServiceDescription(serviceName) {
  if (!serviceName) return '';
  return await fetchServiceDescription(serviceName);
}
