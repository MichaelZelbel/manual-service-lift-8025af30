-- Remove old template records that are no longer needed
DELETE FROM public.form_templates 
WHERE template_name IN (
  'FIRST_STEP_SINGLE',
  'FIRST_STEP_MULTI', 
  'NEXT_STEP_SINGLE',
  'NEXT_STEP_MULTI'
);