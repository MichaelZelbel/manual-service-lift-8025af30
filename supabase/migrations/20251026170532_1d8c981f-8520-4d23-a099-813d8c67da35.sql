-- Create step_descriptions table for storing AI-generated summaries
CREATE TABLE IF NOT EXISTS public.step_descriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key TEXT NOT NULL,
  node_id TEXT,
  step_description TEXT,
  service_description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_key, node_id)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_sd_service_key ON public.step_descriptions(service_key);
CREATE INDEX IF NOT EXISTS idx_sd_service_node ON public.step_descriptions(service_key, node_id);

-- Enable RLS
ALTER TABLE public.step_descriptions ENABLE ROW LEVEL SECURITY;

-- Anyone can read descriptions
CREATE POLICY "Anyone can view step descriptions"
  ON public.step_descriptions
  FOR SELECT
  USING (true);

-- Anyone can insert/update/delete (will restrict later if needed)
CREATE POLICY "Anyone can manage step descriptions"
  ON public.step_descriptions
  FOR ALL
  USING (true)
  WITH CHECK (true);