-- ═══════════════════════════════════════════════════════════════════════════
-- Fix: get_or_create_derived_accounts raised
--   "column reference "derive_key" is ambiguous"
-- because the RETURNS TABLE output columns (derive_key, side, account_id) share
-- names with the bank_import_derived_accounts columns, and the DELETE / lookups
-- referenced those columns UNQUALIFIED — plpgsql cannot tell the OUT variable
-- from the column. Every column reference is now alias-qualified. Behaviour is
-- otherwise identical to migration 20260722000010.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_or_create_derived_accounts(
  p_tenant_id      UUID,
  p_actor_user_id  UUID,
  p_items          JSONB          -- [{ derive_key, name, side }]
)
RETURNS TABLE (derive_key TEXT, side TEXT, account_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item        JSONB;
  v_key         TEXT;
  v_name        TEXT;
  v_side        TEXT;
  v_acct        UUID;
  v_header      UUID;
  v_header_code TEXT;
  v_atype       TEXT;
  v_subtype     TEXT := 'Auto-Generated';
  v_nb          TEXT;
  v_code        TEXT;
  v_seq         INTEGER;
  v_exp_header  UUID;
  v_inc_header  UUID;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'TENANT_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_actor_user_id AND u.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'ACTOR_NOT_IN_TENANT';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_key  := btrim(v_item->>'derive_key');
    v_name := btrim(v_item->>'name');
    v_side := v_item->>'side';
    CONTINUE WHEN v_key = '' OR v_name = '' OR v_side NOT IN ('debit', 'credit');

    -- Reuse the existing ledger for this key+direction when it is still usable.
    SELECT d.account_id INTO v_acct
      FROM public.bank_import_derived_accounts d
      JOIN public.accounts a ON a.id = d.account_id
     WHERE d.tenant_id = p_tenant_id AND d.derive_key = v_key AND d.side = v_side
       AND a.tenant_id = p_tenant_id AND a.is_active AND a.is_postable;

    IF v_acct IS NULL THEN
      -- Drop a stale mapping whose account was deleted / made unpostable.
      DELETE FROM public.bank_import_derived_accounts d
       WHERE d.tenant_id = p_tenant_id AND d.derive_key = v_key AND d.side = v_side;

      -- Direction fixes classification and the parent header.
      IF v_side = 'debit' THEN
        v_atype := 'Expense'; v_nb := 'Debit';  v_header_code := '6900';
      ELSE
        v_atype := 'Income';  v_nb := 'Credit'; v_header_code := '4900';
      END IF;

      -- Per-direction header (created once). Identify by its marker subtype so
      -- a pre-existing account on code 6900/4900 is never hijacked.
      IF v_side = 'debit' THEN v_header := v_exp_header; ELSE v_header := v_inc_header; END IF;
      IF v_header IS NULL THEN
        SELECT a.id INTO v_header FROM public.accounts a
         WHERE a.tenant_id = p_tenant_id AND a.account_type = v_atype
           AND a.account_subtype = v_subtype AND a.parent_account_id IS NULL
         LIMIT 1;
      END IF;
      IF v_header IS NULL THEN
        v_code := public.next_free_account_code(p_tenant_id, v_header_code);
        INSERT INTO public.accounts
          (tenant_id, account_code, account_name, account_type, account_subtype,
           parent_account_id, account_path, account_level, normal_balance,
           is_active, is_postable, is_control_account, is_system, requires_subledger)
        VALUES
          (p_tenant_id, v_code,
           CASE v_side WHEN 'debit' THEN 'Auto-Generated Expenses' ELSE 'Auto-Generated Income' END,
           v_atype, v_subtype, NULL, v_code, 1, v_nb,
           true, false, false, false, false)
        RETURNING id INTO v_header;
      END IF;
      IF v_side = 'debit' THEN v_exp_header := v_header; ELSE v_inc_header := v_header; END IF;

      -- Child ledger, coded beneath its header (6900001, 6900002, …).
      SELECT count(*) INTO v_seq FROM public.accounts a
       WHERE a.tenant_id = p_tenant_id AND a.parent_account_id = v_header;
      LOOP
        v_seq := v_seq + 1;
        v_code := (SELECT a.account_code FROM public.accounts a WHERE a.id = v_header) || lpad(v_seq::text, 4, '0');
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.accounts a WHERE a.tenant_id = p_tenant_id AND a.account_code = v_code);
      END LOOP;

      INSERT INTO public.accounts
        (tenant_id, account_code, account_name, account_type, account_subtype,
         parent_account_id, account_path, account_level, normal_balance,
         is_active, is_postable, is_control_account, is_system, requires_subledger)
      VALUES
        (p_tenant_id, v_code, left(v_name, 120), v_atype, v_subtype,
         v_header, v_code, 2, v_nb, true, true, false, false, false)
      RETURNING id INTO v_acct;

      INSERT INTO public.bank_import_derived_accounts AS d (tenant_id, derive_key, side, account_id, created_by)
      VALUES (p_tenant_id, v_key, v_side, v_acct, p_actor_user_id)
      ON CONFLICT (tenant_id, derive_key, side) DO UPDATE SET account_id = EXCLUDED.account_id;
    END IF;

    derive_key := v_key; side := v_side; account_id := v_acct;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_derived_accounts(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
