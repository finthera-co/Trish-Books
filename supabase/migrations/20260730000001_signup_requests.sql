-- Signup becomes a request queue instead of self-service provisioning.
--
-- Until online payment exists, a visitor cannot be allowed to create a live tenant
-- on their own. So /signup now records an application here; a Super Admin reviews
-- it and, on approval, the account is provisioned and access is sent to the
-- applicant. Nothing in this table grants access by itself.
--
-- Note what is deliberately absent: no password column. The applicant never
-- chooses one, and we never store one — the account is created at approval time
-- and the applicant sets their own password from the link they're emailed.

CREATE TABLE IF NOT EXISTS public.signup_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name     text NOT NULL,
  first_name       text NOT NULL,
  last_name        text NOT NULL,
  email            text NOT NULL,
  phone            text,
  country          text,
  industry         text,
  team_size        text,
  message          text,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Set when approved, so a request can be traced to the tenant it created.
  tenant_id        uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  review_note      text,
  reviewed_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- The review queue is read newest-first and filtered by status.
CREATE INDEX IF NOT EXISTS idx_signup_requests_status
  ON public.signup_requests (status, created_at DESC);

-- One open application per email address. Without this, the public INSERT below is
-- an open door to flooding the queue by resubmitting the same form. Approved and
-- rejected rows are excluded so a rejected applicant can apply again later.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_requests_one_pending
  ON public.signup_requests (lower(email))
  WHERE status = 'pending';

ALTER TABLE public.signup_requests ENABLE ROW LEVEL SECURITY;

-- Anyone may apply. This is the only public write in the schema, so it is kept as
-- narrow as possible: insert only, and the columns that decide anything —
-- status, tenant_id, reviewed_by — are protected by the WITH CHECK below rather
-- than being trusted from the client.
DROP POLICY IF EXISTS "Anyone can submit a signup request" ON public.signup_requests;
CREATE POLICY "Anyone can submit a signup request"
  ON public.signup_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    status = 'pending'
    AND tenant_id IS NULL
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND length(company_name) BETWEEN 1 AND 200
    AND length(first_name) BETWEEN 1 AND 100
    AND length(last_name) BETWEEN 1 AND 100
    AND length(email) BETWEEN 3 AND 320
    AND email LIKE '%_@_%.__%'
    AND (message IS NULL OR length(message) <= 2000)
  );

-- Applications are visible only to Super Admins — they carry personal data and
-- belong to no tenant, so the usual tenant policies cannot apply.
DROP POLICY IF EXISTS "Super admins read signup requests" ON public.signup_requests;
CREATE POLICY "Super admins read signup requests"
  ON public.signup_requests FOR SELECT
  TO authenticated
  USING ((SELECT public.is_super_admin()));

DROP POLICY IF EXISTS "Super admins update signup requests" ON public.signup_requests;
CREATE POLICY "Super admins update signup requests"
  ON public.signup_requests FOR UPDATE
  TO authenticated
  USING ((SELECT public.is_super_admin()))
  WITH CHECK ((SELECT public.is_super_admin()));

-- Counts for the admin badge, without exposing the rows themselves.
CREATE OR REPLACE FUNCTION public.pending_signup_request_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_super_admin()
      THEN (SELECT COUNT(*) FROM public.signup_requests WHERE status = 'pending')
    ELSE 0
  END;
$$;

GRANT EXECUTE ON FUNCTION public.pending_signup_request_count() TO authenticated;
