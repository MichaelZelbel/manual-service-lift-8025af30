-- Create exports table to track export history
CREATE TABLE public.exports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service_id UUID NOT NULL REFERENCES public.manual_services(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('bpmn', 'forms', 'analysis')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  download_url TEXT
);

-- Enable RLS
ALTER TABLE public.exports ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view exports"
ON public.exports
FOR SELECT
USING (true);

CREATE POLICY "Anyone can create exports"
ON public.exports
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update exports"
ON public.exports
FOR UPDATE
USING (true);

-- Create index for better query performance
CREATE INDEX idx_exports_service_id ON public.exports(service_id);
CREATE INDEX idx_exports_created_at ON public.exports(created_at DESC);