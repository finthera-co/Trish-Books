-- Give journal_lines its own tenant_id so its RLS policy stops being a subquery.
--
-- journal_lines has no tenant column, so tenancy was reached through the parent:
--
--   journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = ...)
--     OR is_super_admin()
--
-- Inside an OR, that cannot be planned as a semi-join. Fetching the lines for a
-- single 50-row page instead produced:
--
--   Seq Scan on journal_lines (rows=69978) + two hashed SubPlans of all 35k entry ids
--
-- i.e. reading two rows of detail cost a full scan of the table plus 70k hash probes.
-- Measured alternatives for that same 50-entry lookup:
--
--   IN (SELECT …) OR is_super_admin()      46 ms   (seq scan + hashed subplans)
--   EXISTS (…)    OR is_super_admin()     279 ms   (correlated, per-row)
--   plain tenant_id column                          <- this migration
--
-- A denormalised tenant_id turns the policy into `tenant_id = <constant>`, which is
-- an ordinary indexable comparison with no subquery to plan around.

ALTER TABLE public.journal_lines ADD COLUMN IF NOT EXISTS tenant_id uuid;

UPDATE public.journal_lines jl
SET tenant_id = je.tenant_id
FROM public.journal_entries je
WHERE je.id = jl.journal_entry_id
  AND jl.tenant_id IS DISTINCT FROM je.tenant_id;

-- Keep it correct for every future insert without asking callers to change.
-- The WHEN guard means bulk paths that already set tenant_id (the bank import writes
-- lines in large batches) skip the lookup entirely.
CREATE OR REPLACE FUNCTION public.fn_journal_lines_set_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT je.tenant_id INTO NEW.tenant_id
  FROM public.journal_entries je
  WHERE je.id = NEW.journal_entry_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_lines_set_tenant ON public.journal_lines;
CREATE TRIGGER trg_journal_lines_set_tenant
  BEFORE INSERT OR UPDATE OF journal_entry_id ON public.journal_lines
  FOR EACH ROW
  WHEN (NEW.tenant_id IS NULL)
  EXECUTE FUNCTION public.fn_journal_lines_set_tenant();

ALTER TABLE public.journal_lines ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_lines_tenant
  ON public.journal_lines (tenant_id);

-- Now the policies are plain column comparisons. Same grants as before: a user sees
-- their own tenant's lines, a super admin sees all.
DROP POLICY IF EXISTS "Users can view own tenant journal lines" ON public.journal_lines;
CREATE POLICY "Users can view own tenant journal lines"
  ON public.journal_lines FOR SELECT
  USING (
    tenant_id = (SELECT public.get_user_tenant_id())
    OR (SELECT public.is_super_admin())
  );

DROP POLICY IF EXISTS "Authorized users can manage journal lines" ON public.journal_lines;
CREATE POLICY "Authorized users can manage journal lines"
  ON public.journal_lines FOR ALL
  USING (tenant_id = (SELECT public.get_user_tenant_id()));

ANALYZE public.journal_lines;
