-- Add columns to store document titles for SOPs and Decision Sheets
ALTER TABLE public.mds_data 
ADD COLUMN IF NOT EXISTS sop_titles TEXT,
ADD COLUMN IF NOT EXISTS decision_sheet_titles TEXT;