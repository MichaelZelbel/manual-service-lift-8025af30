-- Add edited_bpmn_xml columns to manual_services and subprocesses tables

ALTER TABLE public.manual_services 
ADD COLUMN IF NOT EXISTS edited_bpmn_xml TEXT;

ALTER TABLE public.subprocesses 
ADD COLUMN IF NOT EXISTS edited_bpmn_xml TEXT;

COMMENT ON COLUMN public.manual_services.edited_bpmn_xml IS 'User-edited BPMN XML, if null falls back to original_bpmn_xml';
COMMENT ON COLUMN public.subprocesses.edited_bpmn_xml IS 'User-edited BPMN XML, if null falls back to original_bpmn_xml';