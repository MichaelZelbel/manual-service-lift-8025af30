-- Create mds_data table for imported MDS service data
CREATE TABLE IF NOT EXISTS public.mds_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_external_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  performing_team TEXT NOT NULL,
  performer_org TEXT NOT NULL,
  step_external_id TEXT NOT NULL,
  step_name TEXT NOT NULL,
  type TEXT NOT NULL,
  candidate_group TEXT,
  sop_urls TEXT,
  decision_sheet_urls TEXT,
  row_hash TEXT NOT NULL,
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(service_external_id, step_external_id)
);

-- Add candidate_group to manual_service_steps
ALTER TABLE public.manual_service_steps 
ADD COLUMN IF NOT EXISTS candidate_group TEXT;

-- Add candidate_group to subprocess_steps
ALTER TABLE public.subprocess_steps 
ADD COLUMN IF NOT EXISTS candidate_group TEXT;

-- Create documents table for tracking PDF downloads
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_external_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  is_decision_sheet BOOLEAN DEFAULT false,
  file_path TEXT,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  downloaded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(service_external_id, source_url)
);

-- Create jobs table for tracking async operations
CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_external_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT DEFAULT 'queued',
  progress INTEGER DEFAULT 0,
  total INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE public.mds_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- RLS policies for mds_data (anyone can view, updates handled by server)
CREATE POLICY "Anyone can view mds_data"
ON public.mds_data FOR SELECT USING (true);

CREATE POLICY "Anyone can insert mds_data"
ON public.mds_data FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update mds_data"
ON public.mds_data FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete mds_data"
ON public.mds_data FOR DELETE USING (true);

-- RLS policies for documents
CREATE POLICY "Anyone can view documents"
ON public.documents FOR SELECT USING (true);

CREATE POLICY "Anyone can insert documents"
ON public.documents FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update documents"
ON public.documents FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete documents"
ON public.documents FOR DELETE USING (true);

-- RLS policies for jobs
CREATE POLICY "Anyone can view jobs"
ON public.jobs FOR SELECT USING (true);

CREATE POLICY "Anyone can insert jobs"
ON public.jobs FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update jobs"
ON public.jobs FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete jobs"
ON public.jobs FOR DELETE USING (true);

-- Create storage buckets for PDFs and exports
INSERT INTO storage.buckets (id, name, public)
VALUES 
  ('sops', 'sops', false),
  ('exports', 'exports', false)
ON CONFLICT (id) DO NOTHING;