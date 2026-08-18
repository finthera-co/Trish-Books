-- ═══════════════════════════════════════════════════════════════════════════
-- BANK IMPORT — legal_compliance_reversal category.
--
-- Reversals of a legal/lawyer payment ("lawyer payment reverse") keep the same
-- Account Type text as the original payment ("Legal & Compliance Cost") in the
-- source workbook — the reversal is only signalled in the free-text
-- description, on the credit side. The engine's side gate was routing every
-- one of these to Suspense (reason side_mismatch) because no reversal sibling
-- category existed for Legal Fees, unlike Salaries/Harvest Payments.
--
-- setup_bank_import_chart() already wires any reversal_category found on the
-- template generically (20260721000003 §2b), so declaring it here is enough
-- for future/re-run setups. This migration also backfills the mapping for
-- tenants that already ran setup, so a re-import posts correctly today.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.bank_import_chart_template
   SET reversal_category = 'legal_compliance_reversal' WHERE account_code = '6250';

INSERT INTO public.bank_category_account_map
  (tenant_id, canonical_category, account_id, expected_side, is_active)
SELECT a.tenant_id, tpl.reversal_category, a.id,
       CASE tpl.expected_side WHEN 'debit' THEN 'credit'
                               WHEN 'credit' THEN 'debit'
                               ELSE 'either' END,
       true
  FROM public.accounts a
  JOIN public.bank_import_chart_template tpl ON tpl.account_code = a.account_code
 WHERE tpl.reversal_category IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.bank_category_account_map m WHERE m.tenant_id = a.tenant_id)
ON CONFLICT (tenant_id, canonical_category) DO NOTHING;
