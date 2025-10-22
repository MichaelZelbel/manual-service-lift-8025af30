-- Add process_step column to mds_data table to track first steps
ALTER TABLE public.mds_data
ADD COLUMN process_step integer;