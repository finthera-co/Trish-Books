-- ─────────────────────────────────────────────────────────────────────────────
-- Delete a single row from the invoice number register
--
-- Trying a few drafts and deleting them burns numbers: each one is handed out,
-- then recorded as cancelled when the draft goes. The counter keeps climbing,
-- so a business that meant to start at 65 finds itself at 69 with four dead
-- rows in between. This removes one such number and hands it back.
--
-- Deleting the highest rows pulls the counter back with them: last_seq is
-- recomputed from what is left, so removing 65-68 makes the next number 65
-- again. That is the point of the operation, not a side effect.
--
-- A number that was actually issued is untouchable. The register's job is to
-- show the IRD that every issued number is accounted for, and an issued number
-- disappearing from it would defeat exactly that.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_invoice_number_row(p_serial text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_row    public.invoice_serial_register%ROWTYPE;
  v_top    int;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant context';
  END IF;
  IF NOT public.tenant_has_feature('legacy_invoice_numbering') THEN
    RAISE EXCEPTION 'Invoice numbering cannot be changed for this account';
  END IF;
  IF public.get_user_role_name() NOT IN ('Company Admin', 'Primary Admin', 'Super Admin') THEN
    RAISE EXCEPTION 'Only an administrator can change invoice numbering';
  END IF;

  SELECT * INTO v_row
    FROM public.invoice_serial_register
   WHERE tenant_id = v_tenant AND serial = p_serial;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Number % is not in the register', p_serial;
  END IF;
  IF v_row.status = 'issued' OR v_row.invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Number % was issued and cannot be removed from the register', p_serial;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.tenant_id = v_tenant AND i.invoice_number = p_serial
  ) THEN
    RAISE EXCEPTION 'An invoice still uses number % — delete or renumber it first', p_serial;
  END IF;

  DELETE FROM public.invoice_serial_register
   WHERE tenant_id = v_tenant AND serial = p_serial;

  -- Hand the number back: the counter follows whatever is left in this bucket,
  -- so clearing the top of the range makes those numbers issuable again.
  SELECT COALESCE(MAX(seq), 0) INTO v_top
    FROM public.invoice_serial_register
   WHERE tenant_id = v_tenant AND branch_code = v_row.branch_code
     AND yy = v_row.yy AND mmm = v_row.mmm;

  UPDATE public.invoice_serial_sequences
     SET last_seq = v_top, updated_at = now()
   WHERE tenant_id = v_tenant AND branch_code = v_row.branch_code
     AND yy = v_row.yy AND mmm = v_row.mmm;

  RETURN v_top + 1;  -- the number that will now be handed out next
END;
$$;

REVOKE ALL ON FUNCTION public.delete_invoice_number_row(text) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_invoice_number_row(text) TO authenticated;

COMMENT ON FUNCTION public.delete_invoice_number_row(text) IS
  'Remove one unissued number from the register and pull the branch counter back to the highest number left. Refuses for issued numbers.';
