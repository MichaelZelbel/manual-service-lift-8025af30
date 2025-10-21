-- Add original_bpmn_xml column to manual_services to store main process BPMN
ALTER TABLE manual_services 
ADD COLUMN IF NOT EXISTS original_bpmn_xml TEXT;

-- Add original_bpmn_xml column to subprocesses to store subprocess BPMN
ALTER TABLE subprocesses 
ADD COLUMN IF NOT EXISTS original_bpmn_xml TEXT;