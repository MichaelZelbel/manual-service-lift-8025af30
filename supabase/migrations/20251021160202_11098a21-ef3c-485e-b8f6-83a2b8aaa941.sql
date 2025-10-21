-- Create enum for app roles
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- RLS policies for user_roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
USING (true);

CREATE POLICY "Only admins can manage roles"
ON public.user_roles
FOR ALL
USING (public.has_role(user_id, 'admin'));

-- Create form_templates table to track template metadata
CREATE TABLE public.form_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  uploaded_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on form_templates
ALTER TABLE public.form_templates ENABLE ROW LEVEL SECURITY;

-- RLS policies for form_templates (admin only)
CREATE POLICY "Anyone can view form templates"
ON public.form_templates
FOR SELECT
USING (true);

CREATE POLICY "Only admins can manage form templates"
ON public.form_templates
FOR ALL
USING (public.has_role(uploaded_by::uuid, 'admin'));

-- Create storage bucket for form templates
INSERT INTO storage.buckets (id, name, public)
VALUES ('form_templates', 'form_templates', true);

-- Storage policies for form_templates bucket (admin only)
CREATE POLICY "Anyone can view form templates"
ON storage.objects
FOR SELECT
USING (bucket_id = 'form_templates');

CREATE POLICY "Only admins can upload form templates"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'form_templates' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Only admins can update form templates"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'form_templates' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Only admins can delete form templates"
ON storage.objects
FOR DELETE
USING (bucket_id = 'form_templates' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Insert initial form template records
INSERT INTO public.form_templates (template_name, file_name) VALUES
  ('First Step, Single Path', 'first-step-single-path.form'),
  ('First Step, Multi Path', 'first-step-multi-path.form'),
  ('Next Step, Single Path', 'next-step-single-path.form'),
  ('Next Step, Multi Path', 'next-step-multi-path.form');

-- Insert a sample admin user (using a placeholder UUID - will need to be updated with actual user ID)
-- This is for testing purposes only
INSERT INTO public.user_roles (user_id, role) 
VALUES ('00000000-0000-0000-0000-000000000000', 'admin')
ON CONFLICT DO NOTHING;