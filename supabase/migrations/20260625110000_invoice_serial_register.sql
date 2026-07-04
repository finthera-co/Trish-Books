-- ─────────────────────────────────────────────────────────────────────────────
-- Invoice serial register (IRD system-generated-invoice compliance)
--
-- Every serial handed out by next_invoice_serial() is recorded here, so the full
-- sequence can be shown to the IRD with each number accounted for as:
--   reserved  — assigned to a draft, not yet issued
--   issued    — the invoice was posted
--   cancelled — the draft was deleted / never issued (reason recorded)
-- By construction there are no UNEXPLAINED gaps: every number has a row.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoice_serial_register (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  serial      TEXT NOT NULL,
  branch_code TEXT NOT NULL,
  yy          INTEGER NOT NULL,
  mmm         TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  invoice_id  UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','issued','cancelled')),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, serial)
);
CREATE INDEX IF NOT EXISTS idx_serial_register_group
  ON public.invoice_serial_register (tenant_id, branch_code, yy, mmm, seq);

ALTER TABLE public.invoice_serial_register ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS serial_register_select ON public.invoice_serial_register;
CREATE POLICY serial_register_select ON public.invoice_serial_register
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.auth_user_id = auth.uid()));
GRANT SELECT ON public.invoice_serial_register TO authenticated;

-- ── next_invoice_serial(): now also records a 'reserved' register row ──
CREATE OR REPLACE FUNCTION public.next_invoice_serial(
  p_branch_code text,
  p_issue_date  date
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_yy     int  := (EXTRACT(YEAR FROM p_issue_date)::int) % 100;
  v_mmm    text;
  v_branch text := NULLIF(btrim(p_branch_code), '');
  v_seq    int;
  v_serial text;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant context for serial generation';
  END IF;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Branch/QQQQ code is required for the invoice serial';
  END IF;
  IF length(v_branch) < 1 OR length(v_branch) > 15 THEN
    RAISE EXCEPTION 'Branch/QQQQ code must be 1-15 characters (got %)', length(v_branch);
  END IF;

  v_mmm := CASE EXTRACT(MONTH FROM p_issue_date)::int
             WHEN 1 THEN 'JAN' WHEN 2 THEN 'FEB' WHEN 3 THEN 'MAR'
             WHEN 4 THEN 'APR' WHEN 5 THEN 'MAY' WHEN 6 THEN 'JUN'
             WHEN 7 THEN 'JUL' WHEN 8 THEN 'AUG' WHEN 9 THEN 'SEP'
             WHEN 10 THEN 'OCT' WHEN 11 THEN 'NOV' WHEN 12 THEN 'DEC'
           END;

  INSERT INTO public.invoice_serial_sequences (tenant_id, branch_code, yy, mmm, last_seq)
  VALUES (v_tenant, v_branch, v_yy, v_mmm, 1)
  ON CONFLICT (tenant_id, branch_code, yy, mmm)
  DO UPDATE SET last_seq = public.invoice_serial_sequences.last_seq + 1,
                updated_at = now()
  RETURNING last_seq INTO v_seq;

  v_serial := lpad(v_yy::text, 2, '0') || v_mmm || '_' || v_branch || '_' || v_seq::text;

  IF length(v_serial) > 40 THEN
    RAISE EXCEPTION 'Generated serial exceeds 40 characters: %', v_serial;
  END IF;
  IF v_serial ~ '\s' THEN
    RAISE EXCEPTION 'Generated serial contains whitespace: %', v_serial;
  END IF;

  -- Account for the number the moment it is handed out.
  INSERT INTO public.invoice_serial_register (tenant_id, serial, branch_code, yy, mmm, seq, status)
  VALUES (v_tenant, v_serial, v_branch, v_yy, v_mmm, v_seq, 'reserved')
  ON CONFLICT (tenant_id, serial) DO NOTHING;

  RETURN v_serial;
END;
$$;

-- ── Cancel a reserved serial (draft deleted / never issued) ──────────
CREATE OR REPLACE FUNCTION public.cancel_invoice_serial(p_serial text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant context'; END IF;
  UPDATE public.invoice_serial_register
     SET status = 'cancelled', reason = COALESCE(p_reason, 'Cancelled'), updated_at = now()
   WHERE tenant_id = v_tenant AND serial = p_serial AND status <> 'issued';
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_invoice_serial(text, text) TO authenticated;

-- ── Backfill: register every existing gazette-format invoice number ───
INSERT INTO public.invoice_serial_register (tenant_id, serial, branch_code, yy, mmm, seq, invoice_id, status)
SELECT i.tenant_id, i.invoice_number,
       split_part(i.invoice_number, '_', 2),
       substring(split_part(i.invoice_number, '_', 1) from 1 for 2)::int,
       substring(split_part(i.invoice_number, '_', 1) from 3 for 3),
       split_part(i.invoice_number, '_', 3)::int,
       i.id,
       CASE WHEN i.status = 'draft' THEN 'reserved' ELSE 'issued' END
FROM public.invoices i
WHERE i.invoice_number ~ '^[0-9]{2}[A-Z]{3}_.+_[0-9]+$'
ON CONFLICT (tenant_id, serial) DO NOTHING;
