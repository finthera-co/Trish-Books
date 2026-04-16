
-- Soft-delete support for tenants
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- User status for suspend/reactivate (may already exist, use IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='status') THEN
    ALTER TABLE public.users ADD COLUMN status text NOT NULL DEFAULT 'active';
  END IF;
END $$;

-- Login activity tracking
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS login_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_at timestamptz DEFAULT NULL;
