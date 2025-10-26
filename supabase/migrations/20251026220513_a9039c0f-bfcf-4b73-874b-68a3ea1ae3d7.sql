-- Simplify mds_data to store URLs in a single column regardless of type
-- Remove the separate sop_urls and decision_sheet_urls columns
ALTER TABLE public.mds_data 
DROP COLUMN IF EXISTS sop_urls,
DROP COLUMN IF EXISTS decision_sheet_urls;

-- Add a single document_urls column for all document URLs
ALTER TABLE public.mds_data 
ADD COLUMN IF NOT EXISTS document_urls TEXT;