-- Make RLS evaluate its helper functions once per query instead of once per row.
--
-- THIS is why the app hangs, and it is not specific to journal entries — it is the
-- dominant cost of every large read in the app.
--
-- The policies called get_user_tenant_id() / is_super_admin() / get_user_role_name()
-- directly. Postgres does not hoist STABLE function calls out of a row filter, so
-- the plan was:
--
--   Index Only Scan on journal_entries (actual time=0.186..526.985 rows=34989)
--     Filter: (tenant_id = get_user_tenant_id()) OR is_super_admin()
--             OR ((tenant_id = get_user_tenant_id()) AND (get_user_role_name() = ANY (...)))
--
-- ~15µs per row × 35k rows ≈ 530ms, on a count that should be single-digit ms. And
-- because tenant_id was compared to a function call rather than a value, it could
-- never become an index condition.
--
-- Wrapping each call in a scalar subquery turns it into an InitPlan: evaluated once,
-- then treated as a constant. The helpers are all STABLE and take no arguments, so
-- this changes only WHEN they are evaluated, never the result — the policies grant
-- and deny exactly what they did before.
--
-- Measured on journal_entries as the `authenticated` role:
--   list_journal_entries(50)          541 ms  ->  see below
--   count_journal_entries()           506 ms
--   gl_monthly_account_movements()   1871 ms
--
-- Every other table in this schema has the same pattern and will want the same
-- treatment; these three are the ones on the journal read path.

-- ── journal_entries ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own tenant journal entries" ON public.journal_entries;
CREATE POLICY "Users can view own tenant journal entries"
  ON public.journal_entries FOR SELECT
  USING (
    tenant_id = (SELECT public.get_user_tenant_id())
    OR (SELECT public.is_super_admin())
  );

DROP POLICY IF EXISTS "Accountants and Admins can manage journal entries" ON public.journal_entries;
CREATE POLICY "Accountants and Admins can manage journal entries"
  ON public.journal_entries FOR ALL
  USING (
    tenant_id = (SELECT public.get_user_tenant_id())
    AND (SELECT public.get_user_role_name()) = ANY (
      ARRAY['Primary Admin'::text, 'Company Admin'::text, 'Accountant'::text, 'Super Admin'::text]
    )
  );

-- ── journal_lines ────────────────────────────────────────────────────────────
-- journal_lines has no tenant_id of its own, so tenancy is reached through the
-- parent entry. The IN-subquery shape is unchanged; only the helper call moves.
DROP POLICY IF EXISTS "Users can view own tenant journal lines" ON public.journal_lines;
CREATE POLICY "Users can view own tenant journal lines"
  ON public.journal_lines FOR SELECT
  USING (
    journal_entry_id IN (
      SELECT je.id FROM public.journal_entries je
      WHERE je.tenant_id = (SELECT public.get_user_tenant_id())
    )
    OR (SELECT public.is_super_admin())
  );

DROP POLICY IF EXISTS "Authorized users can manage journal lines" ON public.journal_lines;
CREATE POLICY "Authorized users can manage journal lines"
  ON public.journal_lines FOR ALL
  USING (
    journal_entry_id IN (
      SELECT je.id FROM public.journal_entries je
      WHERE je.tenant_id = (SELECT public.get_user_tenant_id())
    )
  );

-- ── accounts ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own tenant accounts" ON public.accounts;
CREATE POLICY "Users can view own tenant accounts"
  ON public.accounts FOR SELECT
  USING (
    tenant_id = (SELECT public.get_user_tenant_id())
    OR (SELECT public.is_super_admin())
  );

DROP POLICY IF EXISTS "Authorized users can manage accounts" ON public.accounts;
CREATE POLICY "Authorized users can manage accounts"
  ON public.accounts FOR ALL
  USING (tenant_id = (SELECT public.get_user_tenant_id()));

-- With tenant_id now compared against a constant, a tenant-leading index is usable
-- again for the ordered read (it was not, while the comparison was a function call).
CREATE INDEX IF NOT EXISTS idx_je_tenant_paging
  ON public.journal_entries (tenant_id, entry_date DESC, created_at DESC, id DESC);

ANALYZE public.journal_entries;
ANALYZE public.journal_lines;
