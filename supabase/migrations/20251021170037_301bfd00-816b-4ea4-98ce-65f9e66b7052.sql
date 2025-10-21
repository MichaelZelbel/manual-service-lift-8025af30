-- First, drop foreign key constraints that reference manual_services
ALTER TABLE manual_service_steps DROP CONSTRAINT IF EXISTS manual_service_steps_service_id_fkey;
ALTER TABLE subprocesses DROP CONSTRAINT IF EXISTS subprocesses_service_id_fkey;
ALTER TABLE exports DROP CONSTRAINT IF EXISTS exports_service_id_fkey;

-- Change manual_services.id from UUID to TEXT to match external service IDs
ALTER TABLE manual_services ALTER COLUMN id TYPE TEXT;

-- Change related foreign key columns to TEXT
ALTER TABLE manual_service_steps ALTER COLUMN service_id TYPE TEXT;
ALTER TABLE subprocesses ALTER COLUMN service_id TYPE TEXT;
ALTER TABLE exports ALTER COLUMN service_id TYPE TEXT;

-- Recreate foreign key constraints
ALTER TABLE manual_service_steps 
ADD CONSTRAINT manual_service_steps_service_id_fkey 
FOREIGN KEY (service_id) REFERENCES manual_services(id) ON DELETE CASCADE;

ALTER TABLE subprocesses 
ADD CONSTRAINT subprocesses_service_id_fkey 
FOREIGN KEY (service_id) REFERENCES manual_services(id) ON DELETE CASCADE;

ALTER TABLE exports 
ADD CONSTRAINT exports_service_id_fkey 
FOREIGN KEY (service_id) REFERENCES manual_services(id) ON DELETE CASCADE;