-- Create subprocesses table
CREATE TABLE public.subprocesses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service_id UUID NOT NULL REFERENCES public.manual_services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.subprocesses ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view subprocesses"
ON public.subprocesses
FOR SELECT
USING (true);

CREATE POLICY "Anyone can create subprocesses"
ON public.subprocesses
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update subprocesses"
ON public.subprocesses
FOR UPDATE
USING (true);

CREATE POLICY "Anyone can delete subprocesses"
ON public.subprocesses
FOR DELETE
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_subprocesses_service_id ON public.subprocesses(service_id);

-- Create subprocess_steps table
CREATE TABLE public.subprocess_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  subprocess_id UUID NOT NULL REFERENCES public.subprocesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  step_order INTEGER NOT NULL,
  connections JSONB DEFAULT '[]'::jsonb,
  original_order INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.subprocess_steps ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view subprocess steps"
ON public.subprocess_steps
FOR SELECT
USING (true);

CREATE POLICY "Anyone can create subprocess steps"
ON public.subprocess_steps
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update subprocess steps"
ON public.subprocess_steps
FOR UPDATE
USING (true);

CREATE POLICY "Anyone can delete subprocess steps"
ON public.subprocess_steps
FOR DELETE
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_subprocess_steps_subprocess_id ON public.subprocess_steps(subprocess_id);

-- Insert sample subprocesses for the first manual service
INSERT INTO public.subprocesses (service_id, name)
SELECT 
  id,
  'Credit Eligibility Check'
FROM public.manual_services LIMIT 1;

INSERT INTO public.subprocesses (service_id, name)
SELECT 
  id,
  'Customer Data Validation'
FROM public.manual_services LIMIT 1;

INSERT INTO public.subprocesses (service_id, name)
SELECT 
  id,
  'Document Verification Process'
FROM public.manual_services LIMIT 1;

-- Insert sample steps for the first subprocess
INSERT INTO public.subprocess_steps (subprocess_id, name, description, step_order, connections, original_order)
SELECT 
  id,
  'Retrieve Customer Credit Score',
  'Pull credit score from external credit bureau API',
  1,
  '[{"targetStep": 2, "condition": "score_received"}]'::jsonb,
  1
FROM public.subprocesses WHERE name = 'Credit Eligibility Check' LIMIT 1;

INSERT INTO public.subprocess_steps (subprocess_id, name, description, step_order, connections, original_order)
SELECT 
  id,
  'Evaluate Credit History',
  'Review past payment patterns and outstanding debts',
  2,
  '[{"targetStep": 3, "condition": "history_evaluated"}]'::jsonb,
  2
FROM public.subprocesses WHERE name = 'Credit Eligibility Check' LIMIT 1;

INSERT INTO public.subprocess_steps (subprocess_id, name, description, step_order, connections, original_order)
SELECT 
  id,
  'Calculate Risk Score',
  'Apply internal risk model to determine eligibility',
  3,
  '[{"targetStep": 4, "condition": "calculated"}]'::jsonb,
  3
FROM public.subprocesses WHERE name = 'Credit Eligibility Check' LIMIT 1;

INSERT INTO public.subprocess_steps (subprocess_id, name, description, step_order, connections, original_order)
SELECT 
  id,
  'Generate Eligibility Decision',
  'Approve or reject based on threshold criteria',
  4,
  '[]'::jsonb,
  4
FROM public.subprocesses WHERE name = 'Credit Eligibility Check' LIMIT 1;

-- Insert sample steps for the second subprocess
INSERT INTO public.subprocess_steps (subprocess_id, name, description, step_order, connections, original_order)
SELECT 
  id,
  'Verify Name and Address',
  'Cross-check customer details with national registry',
  1,
  '[{"targetStep": 2, "condition": "verified"}]'::jsonb,
  1
FROM public.subprocesses WHERE name = 'Customer Data Validation' LIMIT 1;

INSERT INTO public.subprocess_steps (subprocess_id, name, description, step_order, connections, original_order)
SELECT 
  id,
  'Validate Contact Information',
  'Confirm email and phone number are active and reachable',
  2,
  '[{"targetStep": 3, "condition": "validated"}]'::jsonb,
  2
FROM public.subprocesses WHERE name = 'Customer Data Validation' LIMIT 1;

INSERT INTO public.subprocess_steps (subprocess_id, name, description, step_order, connections, original_order)
SELECT 
  id,
  'Check for Duplicate Records',
  'Search database for existing customer profiles',
  3,
  '[]'::jsonb,
  3
FROM public.subprocesses WHERE name = 'Customer Data Validation' LIMIT 1;