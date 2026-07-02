-- Gap 3 — give NON_EPF_ALLOWANCES a default GL account mapping.
-- Without it, posting a run that uses the non-EPF bucket is blocked (post-payroll-gl
-- reports it as unmapped). Mirror each tenant's existing ALLOWANCES mapping (same
-- salary/wages expense account, same posting side) so it posts out of the box.
INSERT INTO public.payroll_component_accounts (tenant_id, component_code, posting_side, account_id, is_active)
SELECT pca.tenant_id, 'NON_EPF_ALLOWANCES', pca.posting_side, pca.account_id, true
FROM public.payroll_component_accounts pca
WHERE pca.component_code = 'ALLOWANCES'
  AND NOT EXISTS (
    SELECT 1 FROM public.payroll_component_accounts x
    WHERE x.tenant_id = pca.tenant_id AND x.component_code = 'NON_EPF_ALLOWANCES'
  );
