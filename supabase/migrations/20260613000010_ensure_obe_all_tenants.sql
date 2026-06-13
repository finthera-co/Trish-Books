-- Guarantee the Opening Balance Equity (OBE, code 3900) account exists for every
-- tenant — existing and all future ones — as the canonical balancing clearing
-- account for opening-balance journal entries.
--
-- Canonical OBE spec:
--   account_code='3900', account_name='Opening Balance Equity', account_type='Equity',
--   account_subtype='Opening Balance Equity', normal_balance='credit',
--   is_system=true, is_active=true, is_locked=true, category_id=null
--
-- Schema note: accounts.is_locked exists (boolean); account_path is auto-populated
-- by the BEFORE INSERT trigger fn_set_account_level_path, so it is omitted here.

-- ── Duplicate-proof: one system OBE per tenant ──────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_obe_per_tenant
  ON public.accounts (tenant_id)
  WHERE is_system = true AND account_code = '3900';

-- ── Backfill every existing tenant that lacks OBE ───────────────────────────
INSERT INTO public.accounts (
  tenant_id, account_code, account_name, account_type, account_subtype,
  normal_balance, is_system, is_active, is_locked
)
SELECT t.id, '3900', 'Opening Balance Equity', 'Equity', 'Opening Balance Equity',
       'credit', true, true, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts a
  WHERE a.tenant_id = t.id AND a.account_code = '3900'
);

-- ── Heal any pre-existing OBE rows missing normal_balance / flags ───────────
UPDATE public.accounts
SET normal_balance  = COALESCE(NULLIF(normal_balance, ''), 'credit'),
    account_subtype = 'Opening Balance Equity',
    is_system       = true,
    is_locked       = true
WHERE account_code = '3900';

-- ── Auto-provision OBE for NEW tenants at the DB level (primary creation path) ─
CREATE OR REPLACE FUNCTION public.create_obe_for_new_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.accounts (
    tenant_id, account_code, account_name, account_type, account_subtype,
    normal_balance, is_system, is_active, is_locked
  )
  VALUES (NEW.id, '3900', 'Opening Balance Equity', 'Equity', 'Opening Balance Equity',
          'credit', true, true, true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_create_obe_for_new_tenant ON public.tenants;
CREATE TRIGGER trg_create_obe_for_new_tenant
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.create_obe_for_new_tenant();
