
-- 1) account_settings table (tenant-level defaults)
CREATE TABLE IF NOT EXISTS public.account_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  ar_account_id uuid REFERENCES public.accounts(id),
  sales_account_id uuid REFERENCES public.accounts(id),
  tax_payable_account_id uuid REFERENCES public.accounts(id),
  ap_account_id uuid REFERENCES public.accounts(id),
  bank_account_id uuid REFERENCES public.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view settings"
  ON public.account_settings FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "Admins can manage settings"
  ON public.account_settings FOR ALL
  USING (tenant_id = public.get_user_tenant_id() AND (public.is_primary_admin() OR public.is_super_admin()))
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND (public.is_primary_admin() OR public.is_super_admin()));

CREATE TRIGGER trg_account_settings_updated
  BEFORE UPDATE ON public.account_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Per-line revenue account on invoice_items
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id);

-- 3) Audit columns on invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.users(id);

-- 4) Idempotency: only ONE non-voided journal per (source_type, source_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_je_unique_source
  ON public.journal_entries (source_type, source_id)
  WHERE source_type IS NOT NULL
    AND source_id IS NOT NULL
    AND status <> 'voided';

-- 5) Lock posted invoices (prevent edits to financial fields & number)
CREATE OR REPLACE FUNCTION public.block_posted_invoice_edits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'Cannot delete a posted invoice (%). Void it instead.', OLD.invoice_number;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'posted' AND NEW.status = 'posted' THEN
    IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
       OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.issue_date IS DISTINCT FROM OLD.issue_date THEN
      RAISE EXCEPTION 'Posted invoice % is immutable. Void and re-issue to make changes.', OLD.invoice_number;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_posted_invoice_edits ON public.invoices;
CREATE TRIGGER trg_block_posted_invoice_edits
  BEFORE UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.block_posted_invoice_edits();
