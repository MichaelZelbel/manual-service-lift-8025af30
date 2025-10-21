-- Add subprocess_id foreign key to manual_service_steps
ALTER TABLE public.manual_service_steps
ADD COLUMN subprocess_id UUID REFERENCES public.subprocesses(id) ON DELETE SET NULL;

-- Update existing steps to link them to subprocesses
-- Link steps from the first service to its subprocesses
UPDATE public.manual_service_steps ms
SET subprocess_id = (
  SELECT s.id 
  FROM public.subprocesses s 
  WHERE s.service_id = ms.service_id 
  ORDER BY s.created_at 
  LIMIT 1 OFFSET (ms.step_order - 1)
)
WHERE EXISTS (
  SELECT 1 FROM public.subprocesses s WHERE s.service_id = ms.service_id
);

-- Create index for better query performance
CREATE INDEX idx_manual_service_steps_subprocess_id ON public.manual_service_steps(subprocess_id);