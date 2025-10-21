-- Create manual_services table
CREATE TABLE public.manual_services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  performing_team TEXT NOT NULL,
  performer_org TEXT NOT NULL,
  last_edited TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_bpmn_export TIMESTAMP WITH TIME ZONE,
  last_form_export TIMESTAMP WITH TIME ZONE,
  last_analysis TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.manual_services ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all users to read manual services
CREATE POLICY "Anyone can view manual services"
  ON public.manual_services
  FOR SELECT
  USING (true);

-- Create policy to allow all users to insert manual services
CREATE POLICY "Anyone can create manual services"
  ON public.manual_services
  FOR INSERT
  WITH CHECK (true);

-- Create policy to allow all users to update manual services
CREATE POLICY "Anyone can update manual services"
  ON public.manual_services
  FOR UPDATE
  USING (true);

-- Create policy to allow all users to delete manual services
CREATE POLICY "Anyone can delete manual services"
  ON public.manual_services
  FOR DELETE
  USING (true);

-- Insert sample data
INSERT INTO public.manual_services (name, performing_team, performer_org, last_edited, last_bpmn_export, last_form_export, last_analysis)
VALUES
  ('Customer Onboarding Process', 'Compliance Team', 'Operations Division', now() - interval '2 hours', now() - interval '1 day', now() - interval '1 day', now() - interval '3 days'),
  ('Loan Application Review', 'Credit Assessment', 'Lending Department', now() - interval '5 hours', now() - interval '2 days', now() - interval '2 days', now() - interval '5 days'),
  ('Account Closure Workflow', 'Customer Service', 'Retail Banking', now() - interval '1 day', now() - interval '3 days', NULL, now() - interval '7 days'),
  ('Transaction Dispute Resolution', 'Fraud Prevention', 'Security Division', now() - interval '3 hours', now() - interval '1 day', now() - interval '1 day', now() - interval '2 days'),
  ('Wire Transfer Authorization', 'Payment Processing', 'Treasury Operations', now() - interval '6 hours', NULL, NULL, now() - interval '4 days'),
  ('KYC Document Verification', 'Compliance Team', 'Risk Management', now() - interval '12 hours', now() - interval '5 days', now() - interval '5 days', now() - interval '6 days'),
  ('Credit Card Issuance', 'Card Services', 'Retail Banking', now() - interval '4 hours', now() - interval '2 days', now() - interval '2 days', now() - interval '3 days'),
  ('Mortgage Pre-Approval', 'Mortgage Team', 'Lending Department', now() - interval '8 hours', now() - interval '1 day', NULL, now() - interval '2 days'),
  ('Corporate Account Setup', 'Business Banking', 'Commercial Division', now() - interval '1 day', NULL, NULL, NULL);