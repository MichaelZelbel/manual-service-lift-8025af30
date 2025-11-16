-- Add last_camunda_transfer column to manual_services table
ALTER TABLE public.manual_services
ADD COLUMN IF NOT EXISTS last_camunda_transfer TIMESTAMP WITH TIME ZONE;