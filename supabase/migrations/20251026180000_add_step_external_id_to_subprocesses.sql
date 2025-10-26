-- Add step_external_id column to subprocesses table to link subprocesses to their call activities
ALTER TABLE public.subprocesses
ADD COLUMN IF NOT EXISTS step_external_id TEXT;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_subprocesses_step_external_id ON public.subprocesses(step_external_id);
