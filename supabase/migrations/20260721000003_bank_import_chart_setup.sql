-- ═══════════════════════════════════════════════════════════════════════════
-- BANK IMPORT — chart of accounts template + one-click setup.
--
-- The client's own chart is the posting target for the bank statement
-- pipeline. This installs it as a TEMPLATE plus an idempotent, user-triggered
-- setup function — deliberately NOT auto-seeded at migration time, because
-- default COA seeding was removed on 2026-06-13 and new tenants intentionally
-- start with only OBE 3900.
--
-- Structure mirrors the source workbook's own grouping: each group is a
-- non-postable HEADER account, with postable detail accounts beneath it, so
-- balances roll up. Detail accounts under PPE additionally satisfy
-- fn_require_subledger_parent (fixed-asset detail must have a parent).
--
--   1600 Property, Plant & Equipment    4000 Income
--   5000 Purchases                      6000 Administration expenses
--   7000 Selling & distribution         8000 Financial & other expenses
--
-- setup_bank_import_chart():
--   1. creates missing accounts, headers first (existing accounts untouched)
--   2. wires bank_category_account_map: canonical category → account + side
--   3. sets the two directional suspense accounts on account_settings
-- Safe to re-run: every step is guarded.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.bank_import_chart_template (
  account_code text PRIMARY KEY,
  account_name text NOT NULL,
  account_type text NOT NULL,
  account_subtype text,
  parent_code text,                 -- NULL = group header (non-postable)
  -- canonical category this account is the posting target for (NULL = no
  -- direct bank-import mapping; the account still exists for manual use)
  canonical_category text,
  -- A reversal category posts to the SAME account on the OPPOSITE side
  -- ("Salary Reverse" credits Salaries). Without this the workbook's routine
  -- reversal rows would all land in Suspense.
  reversal_category text,
  expected_side text NOT NULL DEFAULT 'either'
    CHECK (expected_side IN ('debit', 'credit', 'either')),
  sort_order integer NOT NULL
);

-- Read-only reference data: every authenticated user may read the template.
ALTER TABLE public.bank_import_chart_template ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_import_chart_template read" ON public.bank_import_chart_template
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.bank_import_chart_template
  (account_code, account_name, account_type, account_subtype, parent_code, canonical_category, expected_side, sort_order)
VALUES
  -- ── Property, Plant & Equipment ────────────────────────────────────────
  ('1600', 'Property, Plant & Equipment', 'Asset', 'Property, Plant & Equipment', NULL, NULL, 'debit', 1),
  ('1610', 'Land',                     'Asset', 'Fixed Asset', '1600', NULL, 'debit', 10),
  ('1620', 'Building',                 'Asset', 'Fixed Asset', '1600', NULL, 'debit', 11),
  ('1630', 'Office Equipment',         'Asset', 'Fixed Asset', '1600', NULL, 'debit', 12),
  ('1640', 'Other Equipment',          'Asset', 'Fixed Asset', '1600', NULL, 'debit', 13),
  ('1650', 'Furniture & Fittings',     'Asset', 'Fixed Asset', '1600', NULL, 'debit', 14),
  ('1660', 'Name Board',               'Asset', 'Fixed Asset', '1600', NULL, 'debit', 15),

  -- ── Income ─────────────────────────────────────────────────────────────
  -- 4010 Unrecognized Deposits is the SUSPENSE account for unresolved money IN.
  ('4000', 'Income',                   'Income', 'Income', NULL, NULL, 'credit', 2),
  ('4010', 'Unrecognized Deposits',    'Income', 'Suspense',     '4000', NULL,              'credit', 20),
  ('4020', 'Customer Deposits',        'Income', 'Sales',        '4000', NULL,              'credit', 21),
  ('4030', 'Deelecta Sales',           'Income', 'Sales',        '4000', 'deelecta_sales',  'credit', 22),
  ('4040', 'Guava Sales',              'Income', 'Sales',        '4000', 'guava_sales',     'credit', 23),
  ('4050', 'Interest Income',          'Income', 'Other Income', '4000', 'interest_income', 'credit', 24),

  -- ── Purchases (cost of sales) ──────────────────────────────────────────
  ('5000', 'Purchases',                'Cost of Goods Sold', 'Purchases', NULL, NULL, 'debit', 3),
  ('5010', 'T Shirts',                 'Cost of Goods Sold', 'Purchases', '5000', 't_shirts', 'debit', 30),
  ('5020', 'Umbrella',                 'Cost of Goods Sold', 'Purchases', '5000', 'umbrella', 'debit', 31),

  -- ── Administration expenses ────────────────────────────────────────────
  -- 6010 Unrecognized Payments is the SUSPENSE account for unresolved money OUT.
  ('6000', 'Administration Expenses',  'Expense', 'Administration Expenses', NULL, NULL, 'debit', 4),
  ('6010', 'Unrecognized Payments',            'Expense', 'Suspense', '6000', NULL, 'debit', 40),
  ('6020', 'Accounting Charges',               'Expense', 'Administration Expenses', '6000', 'accounting_charges', 'debit', 41),
  ('6030', 'Allowances',                       'Expense', 'Administration Expenses', '6000', 'fixed_allowance', 'debit', 42),
  ('6040', 'Director''s Salaries & Allowances','Expense', 'Administration Expenses', '6000', 'director_remuneration', 'debit', 43),
  ('6050', 'Award Ceremony Expenses',          'Expense', 'Administration Expenses', '6000', 'award_ceremony', 'debit', 44),
  ('6060', 'Branch Opening Expenses',          'Expense', 'Administration Expenses', '6000', 'branch_opening', 'debit', 45),
  ('6070', 'Building Maintenance',             'Expense', 'Administration Expenses', '6000', 'building_maintenance', 'debit', 46),
  ('6080', 'Building Rent',                    'Expense', 'Administration Expenses', '6000', 'building_rent', 'debit', 47),
  ('6090', 'Competition Expenses',             'Expense', 'Administration Expenses', '6000', 'competition', 'debit', 48),
  ('6100', 'Decoration Expenses',              'Expense', 'Administration Expenses', '6000', 'decoration', 'debit', 49),
  ('6110', 'Dialog Connection',                'Expense', 'Administration Expenses', '6000', 'dialog_connection', 'debit', 50),
  ('6120', 'Donation',                         'Expense', 'Administration Expenses', '6000', 'donation', 'debit', 51),
  ('6130', 'Electricity',                      'Expense', 'Administration Expenses', '6000', 'electricity', 'debit', 52),
  ('6140', 'Food & Beverage',                  'Expense', 'Administration Expenses', '6000', 'food_beverage', 'debit', 53),
  ('6150', 'Fuel',                             'Expense', 'Administration Expenses', '6000', 'fuel', 'debit', 54),
  ('6160', 'Function Expenses',                'Expense', 'Administration Expenses', '6000', 'function_expenses', 'debit', 55),
  ('6170', 'Harvest Payments',                 'Expense', 'Administration Expenses', '6000', 'harvest', 'debit', 56),
  ('6180', 'Internet Connection',              'Expense', 'Administration Expenses', '6000', 'internet_connection', 'debit', 57),
  ('6190', 'Labor Charges',                    'Expense', 'Administration Expenses', '6000', 'labor_charges', 'debit', 58),
  ('6200', 'Office Equipment Maintenance',     'Expense', 'Administration Expenses', '6000', 'office_equipment_maintenance', 'debit', 59),
  ('6210', 'Petty Cash Expenses',              'Expense', 'Administration Expenses', '6000', 'petty_cash', 'debit', 60),
  ('6220', 'Postage & Courier',                'Expense', 'Administration Expenses', '6000', 'postage_courier', 'debit', 61),
  ('6230', 'Printing & Stationery',            'Expense', 'Administration Expenses', '6000', 'printing_stationery', 'debit', 62),
  ('6240', 'Professional Expenses',            'Expense', 'Administration Expenses', '6000', 'professional_expenses', 'debit', 63),
  ('6250', 'Legal Fees',                       'Expense', 'Administration Expenses', '6000', 'legal_compliance', 'debit', 64),
  ('6260', 'Salaries',                         'Expense', 'Administration Expenses', '6000', 'salary', 'debit', 65),
  ('6270', 'Sounds',                           'Expense', 'Administration Expenses', '6000', 'sounds', 'debit', 66),
  ('6280', 'Staff Welfare',                    'Expense', 'Administration Expenses', '6000', 'welfare', 'debit', 67),
  ('6290', 'Stamp Fees',                       'Expense', 'Administration Expenses', '6000', 'stamp_fees', 'debit', 68),
  ('6300', 'Sundry Expenses',                  'Expense', 'Administration Expenses', '6000', 'admin_other', 'debit', 69),
  ('6310', 'Telephone',                        'Expense', 'Administration Expenses', '6000', 'telephone', 'debit', 70),
  ('6320', 'Training Expenses',                'Expense', 'Administration Expenses', '6000', 'training_development', 'debit', 71),
  ('6330', 'Travelling Expenses',              'Expense', 'Administration Expenses', '6000', 'orc_travelling_allowance', 'debit', 72),
  ('6340', 'Vehicle Rent',                     'Expense', 'Administration Expenses', '6000', 'vehicle_rent', 'debit', 73),
  ('6350', 'House Keeping Items',              'Expense', 'Administration Expenses', '6000', 'house_keeping', 'debit', 74),
  ('6360', 'Water',                            'Expense', 'Administration Expenses', '6000', 'water', 'debit', 75),
  ('6370', 'Delecta Launch Expenses',          'Expense', 'Administration Expenses', '6000', 'delecta', 'debit', 76),
  ('6380', 'Pirith Ceremony Expenses',         'Expense', 'Administration Expenses', '6000', 'pirith_ceremony', 'debit', 77),
  ('6390', 'Plantation',                       'Expense', 'Administration Expenses', '6000', 'plantation', 'debit', 78),
  ('6400', 'Insurance',                        'Expense', 'Administration Expenses', '6000', 'insurance', 'debit', 79),
  ('6410', 'Event Expenses',                   'Expense', 'Administration Expenses', '6000', 'event_expenses', 'debit', 80),
  ('6420', 'Vehicle Repair',                   'Expense', 'Administration Expenses', '6000', 'vehicle_repair', 'debit', 81),
  ('6430', 'Office Repair & Maintenance',      'Expense', 'Administration Expenses', '6000', 'office_repair', 'debit', 82),
  ('6440', 'Green Crest',                      'Expense', 'Administration Expenses', '6000', 'green_crest', 'debit', 83),
  ('6450', 'Lofty',                            'Expense', 'Administration Expenses', '6000', 'lofty', 'debit', 84),
  ('6460', 'Consultation Charges',             'Expense', 'Administration Expenses', '6000', 'consultation_charges', 'debit', 85),

  -- ── Selling & distribution expenses ────────────────────────────────────
  ('7000', 'Selling & Distribution Expenses', 'Expense', 'Selling & Distribution', NULL, NULL, 'debit', 5),
  ('7010', 'Advertising Expenses',     'Expense', 'Selling & Distribution', '7000', 'advertising', 'debit', 90),
  ('7020', 'Branding Expenses',        'Expense', 'Selling & Distribution', '7000', 'branding', 'debit', 91),
  ('7030', 'Commissions',              'Expense', 'Selling & Distribution', '7000', 'commission', 'debit', 92),
  ('7040', 'Promotion',                'Expense', 'Selling & Distribution', '7000', 'promotion', 'debit', 93),
  ('7050', 'Marketing',                'Expense', 'Selling & Distribution', '7000', 'marketing', 'debit', 94),

  -- ── Financial & other expenses ─────────────────────────────────────────
  ('8000', 'Financial & Other Expenses', 'Expense', 'Financial & Other Expenses', NULL, NULL, 'debit', 6),
  ('8010', 'Bank Charges',             'Expense', 'Financial & Other Expenses', '8000', 'bank_charges', 'debit', 100)
ON CONFLICT (account_code) DO NOTHING;

-- Reversal categories share their base account on the opposite side.
UPDATE public.bank_import_chart_template
   SET reversal_category = 'harvest_reversal' WHERE account_code = '6170';
UPDATE public.bank_import_chart_template
   SET reversal_category = 'salary_reversal'  WHERE account_code = '6260';


-- ═══════════════════════════════════════════════════════════════════════════
-- setup_bank_import_chart — idempotent provisioning for the calling tenant.
-- Headers are created first (sort_order 1–6) so children can reference them.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.setup_bank_import_chart()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_tenant_id   UUID;
  v_role        TEXT;
  v_t           RECORD;
  v_acct_id     UUID;
  v_parent_id   UUID;
  v_parent_path TEXT;
  v_created     INTEGER := 0;
  v_mapped      INTEGER := 0;
  v_deposit_id  UUID;
  v_payment_id  UUID;
BEGIN
  SELECT u.id, u.tenant_id, r.role_name INTO v_user_id, v_tenant_id, v_role
    FROM public.users u
    LEFT JOIN public.roles r ON r.id = u.role_id
   WHERE u.auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('Super Admin', 'Primary Admin', 'Company Admin', 'Accountant') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: role % cannot set up the chart of accounts', COALESCE(v_role, 'unknown');
  END IF;

  -- 1. Create missing accounts (existing accounts are never modified).
  FOR v_t IN SELECT * FROM public.bank_import_chart_template ORDER BY sort_order LOOP
    SELECT id INTO v_acct_id FROM public.accounts
     WHERE tenant_id = v_tenant_id AND account_code = v_t.account_code;

    IF v_acct_id IS NULL THEN
      v_parent_id := NULL;
      v_parent_path := NULL;
      IF v_t.parent_code IS NOT NULL THEN
        SELECT id, account_path INTO v_parent_id, v_parent_path FROM public.accounts
         WHERE tenant_id = v_tenant_id AND account_code = v_t.parent_code;
        IF v_parent_id IS NULL THEN
          RAISE EXCEPTION 'CHART_PARENT_MISSING: parent % for account % was not created',
            v_t.parent_code, v_t.account_code;
        END IF;
      END IF;

      INSERT INTO public.accounts
        (tenant_id, account_code, account_name, account_type, account_subtype,
         parent_account_id, account_path, account_level, normal_balance,
         is_active, is_postable, is_control_account, is_system, requires_subledger)
      VALUES
        (v_tenant_id, v_t.account_code, v_t.account_name, v_t.account_type, v_t.account_subtype,
         v_parent_id,
         COALESCE(v_parent_path || ' > ', '') || v_t.account_code || ' ' || v_t.account_name,
         CASE WHEN v_t.parent_code IS NULL THEN 1 ELSE 2 END,
         CASE WHEN v_t.account_type IN ('Asset', 'Expense', 'Cost of Goods Sold', 'Other Expense')
              THEN 'Debit' ELSE 'Credit' END,
         true,
         v_t.parent_code IS NOT NULL,   -- headers are NOT postable
         false, false, false)
      RETURNING id INTO v_acct_id;
      v_created := v_created + 1;
    END IF;

    -- 2. Wire the canonical category → account mapping.
    IF v_t.canonical_category IS NOT NULL THEN
      INSERT INTO public.bank_category_account_map
        (tenant_id, canonical_category, account_id, expected_side, is_active, created_by)
      VALUES (v_tenant_id, v_t.canonical_category, v_acct_id, v_t.expected_side, true, v_user_id)
      ON CONFLICT (tenant_id, canonical_category) DO NOTHING;
      IF FOUND THEN v_mapped := v_mapped + 1; END IF;
    END IF;

    -- 2b. Reversal category → same account, opposite side.
    IF v_t.reversal_category IS NOT NULL THEN
      INSERT INTO public.bank_category_account_map
        (tenant_id, canonical_category, account_id, expected_side, is_active, created_by)
      VALUES (v_tenant_id, v_t.reversal_category, v_acct_id,
              CASE v_t.expected_side WHEN 'debit' THEN 'credit'
                                     WHEN 'credit' THEN 'debit'
                                     ELSE 'either' END,
              true, v_user_id)
      ON CONFLICT (tenant_id, canonical_category) DO NOTHING;
      IF FOUND THEN v_mapped := v_mapped + 1; END IF;
    END IF;

    IF v_t.account_code = '4010' THEN v_deposit_id := v_acct_id; END IF;
    IF v_t.account_code = '6010' THEN v_payment_id := v_acct_id; END IF;
  END LOOP;

  -- 3. Point the directional suspense settings at the two Unrecognized accounts.
  INSERT INTO public.account_settings
    (tenant_id, bank_import_unrecognized_deposit_account_id, bank_import_unrecognized_payment_account_id)
  VALUES (v_tenant_id, v_deposit_id, v_payment_id)
  ON CONFLICT (tenant_id) DO UPDATE SET
    bank_import_unrecognized_deposit_account_id =
      COALESCE(public.account_settings.bank_import_unrecognized_deposit_account_id, EXCLUDED.bank_import_unrecognized_deposit_account_id),
    bank_import_unrecognized_payment_account_id =
      COALESCE(public.account_settings.bank_import_unrecognized_payment_account_id, EXCLUDED.bank_import_unrecognized_payment_account_id);

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, details)
  VALUES (v_tenant_id, v_user_id, 'Bank Import Chart Setup', 'accounts', v_tenant_id,
          jsonb_build_object('accounts_created', v_created, 'categories_mapped', v_mapped));

  RETURN jsonb_build_object(
    'accounts_created', v_created,
    'categories_mapped', v_mapped,
    'unrecognized_deposit_account_id', v_deposit_id,
    'unrecognized_payment_account_id', v_payment_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.setup_bank_import_chart() TO authenticated;
