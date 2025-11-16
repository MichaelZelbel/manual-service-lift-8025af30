-- Add last_camunda_transfer timestamp to manual_services table
ALTER TABLE public.manual_services
ADD COLUMN IF NOT EXISTS last_camunda_transfer TIMESTAMP WITH TIME ZONE;

-- Add comment to describe the column
COMMENT ON COLUMN public.manual_services.last_camunda_transfer IS 'Timestamp of the last successful transfer to Camunda 8 Web Modeler';
