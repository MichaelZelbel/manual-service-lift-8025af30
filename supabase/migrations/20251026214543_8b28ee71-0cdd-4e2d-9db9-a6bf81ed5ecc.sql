-- Remove the incorrectly added columns
ALTER TABLE public.mds_data 
DROP COLUMN IF EXISTS sop_titles,
DROP COLUMN IF EXISTS decision_sheet_titles;

-- Add the correct single column for document names (Column G: SOP/Decision Sheet Name)
ALTER TABLE public.mds_data 
ADD COLUMN IF NOT EXISTS document_name TEXT;