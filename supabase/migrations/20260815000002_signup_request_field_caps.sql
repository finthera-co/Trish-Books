-- Cap the columns the public INSERT policy left unbounded.
--
-- 20260730000001 bounded company_name, first_name, last_name, email and message,
-- but not phone, country, industry or team_size. This is the only anon-writable
-- table in the schema, so those four are a direct route to filling storage from
-- an unauthenticated form post — the browser never sends more than a phone number
-- in `phone`, but nothing was making the browser the one asking.
--
-- team_size is an enum in every form that writes it, so it is pinned to that list
-- rather than merely bounded; country is likewise fixed by the product today.
-- Both are kept nullable, which is what the existing forms send when unanswered.

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
    -- New below.
    AND (phone IS NULL OR length(phone) BETWEEN 1 AND 32)
    AND (country IS NULL OR length(country) BETWEEN 1 AND 100)
    AND (industry IS NULL OR length(industry) BETWEEN 1 AND 100)
    AND (team_size IS NULL OR team_size IN ('1', '2-5', '6-20', '21-50', '50+', '51+'))
    -- review_note is the reviewer's field, not the applicant's. It was never
    -- written by the public form and should not become writable by one.
    AND review_note IS NULL
  );
