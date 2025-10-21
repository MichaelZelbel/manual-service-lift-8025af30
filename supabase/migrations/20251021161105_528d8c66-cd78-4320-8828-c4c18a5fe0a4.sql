-- Drop existing problematic storage policies
DROP POLICY IF EXISTS "Only admins can upload form templates" ON storage.objects;
DROP POLICY IF EXISTS "Only admins can update form templates" ON storage.objects;
DROP POLICY IF EXISTS "Only admins can delete form templates" ON storage.objects;

-- Create simple storage policies (access controlled by edge functions)
CREATE POLICY "Service role can manage form templates"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'form_templates');

-- Update form_templates table structure for clarity
ALTER TABLE public.form_templates 
DROP CONSTRAINT IF EXISTS form_templates_template_name_key;

-- Add new unique constraint and update data model
UPDATE public.form_templates SET 
  template_name = CASE template_name
    WHEN 'First Step, Single Path' THEN 'FIRST_STEP_SINGLE'
    WHEN 'First Step, Multi Path' THEN 'FIRST_STEP_MULTI'
    WHEN 'Next Step, Single Path' THEN 'NEXT_STEP_SINGLE'
    WHEN 'Next Step, Multi Path' THEN 'NEXT_STEP_MULTI'
    ELSE template_name
  END;

ALTER TABLE public.form_templates 
ADD CONSTRAINT form_templates_template_name_key UNIQUE (template_name);