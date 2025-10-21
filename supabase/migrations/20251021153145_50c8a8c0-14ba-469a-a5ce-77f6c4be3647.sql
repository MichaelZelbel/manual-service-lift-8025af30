-- Create manual_service_steps table
CREATE TABLE public.manual_service_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service_id UUID NOT NULL REFERENCES public.manual_services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  step_order INTEGER NOT NULL,
  connections JSONB DEFAULT '[]'::jsonb,
  original_order INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.manual_service_steps ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view manual service steps"
ON public.manual_service_steps
FOR SELECT
USING (true);

CREATE POLICY "Anyone can create manual service steps"
ON public.manual_service_steps
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update manual service steps"
ON public.manual_service_steps
FOR UPDATE
USING (true);

CREATE POLICY "Anyone can delete manual service steps"
ON public.manual_service_steps
FOR DELETE
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_manual_service_steps_service_id ON public.manual_service_steps(service_id);

-- Insert sample data for the first manual service
INSERT INTO public.manual_service_steps (service_id, name, description, step_order, connections, original_order)
SELECT 
  id,
  'Initial Customer Contact',
  'Receive and log customer inquiry through phone, email, or web portal',
  1,
  '[{"targetStep": 2, "condition": "standard"}]'::jsonb,
  1
FROM public.manual_services LIMIT 1;

INSERT INTO public.manual_service_steps (service_id, name, description, step_order, connections, original_order)
SELECT 
  id,
  'Verify Customer Identity',
  'Check customer credentials and verify identity using internal systems',
  2,
  '[{"targetStep": 3, "condition": "verified"}]'::jsonb,
  2
FROM public.manual_services LIMIT 1;

INSERT INTO public.manual_service_steps (service_id, name, description, step_order, connections, original_order)
SELECT 
  id,
  'Assess Service Request',
  'Determine the type and complexity of the service request',
  3,
  '[{"targetStep": 4, "condition": "simple"}, {"targetStep": 5, "condition": "complex"}]'::jsonb,
  3
FROM public.manual_services LIMIT 1;

INSERT INTO public.manual_service_steps (service_id, name, description, step_order, connections, original_order)
SELECT 
  id,
  'Process Simple Request',
  'Handle straightforward requests using standard procedures',
  4,
  '[{"targetStep": 6, "condition": "completed"}]'::jsonb,
  4
FROM public.manual_services LIMIT 1;

INSERT INTO public.manual_service_steps (service_id, name, description, step_order, connections, original_order)
SELECT 
  id,
  'Escalate Complex Request',
  'Forward complex cases to specialized team for detailed review',
  5,
  '[{"targetStep": 6, "condition": "reviewed"}]'::jsonb,
  5
FROM public.manual_services LIMIT 1;

INSERT INTO public.manual_service_steps (service_id, name, description, step_order, connections, original_order)
SELECT 
  id,
  'Quality Check',
  'Review completed work for accuracy and compliance',
  6,
  '[{"targetStep": 7, "condition": "passed"}]'::jsonb,
  6
FROM public.manual_services LIMIT 1;

INSERT INTO public.manual_service_steps (service_id, name, description, step_order, connections, original_order)
SELECT 
  id,
  'Customer Notification',
  'Inform customer of the outcome and next steps',
  7,
  '[]'::jsonb,
  7
FROM public.manual_services LIMIT 1;