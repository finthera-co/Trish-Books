-- Retroactively sync all posted journal entries that are missing from transactions
INSERT INTO transactions (tenant_id, date, amount, type, account_id, category, description, source_type, source_id)
SELECT 
  je.tenant_id,
  je.entry_date,
  CASE WHEN jl.debit > 0 THEN jl.debit ELSE jl.credit END,
  CASE 
    WHEN jl.debit > 0 AND a.account_type IN ('Expense', 'Cost of Goods Sold') THEN 'expense'
    WHEN jl.credit > 0 AND a.account_type = 'Revenue' THEN 'income'
  END,
  jl.account_id,
  a.account_type,
  je.description,
  'journal_entry',
  je.id
FROM journal_entries je
JOIN journal_lines jl ON jl.journal_entry_id = je.id
JOIN accounts a ON a.id = jl.account_id
WHERE je.status = 'posted'
  AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.source_id = je.id AND t.source_type = 'journal_entry')
  AND (
    (jl.debit > 0 AND a.account_type IN ('Expense', 'Cost of Goods Sold'))
    OR (jl.credit > 0 AND a.account_type = 'Revenue')
  );