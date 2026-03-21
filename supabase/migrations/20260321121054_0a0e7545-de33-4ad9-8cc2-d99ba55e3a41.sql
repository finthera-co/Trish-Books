-- Backfill opening_balance on accounts from existing opening_balance journal entries
UPDATE accounts a
SET 
  opening_balance = sub.amount,
  opening_balance_type = CASE WHEN sub.debit > 0 THEN 'debit' ELSE 'credit' END
FROM (
  SELECT 
    jl.account_id,
    SUM(jl.debit) as debit,
    SUM(jl.credit) as credit,
    CASE WHEN SUM(jl.debit) > SUM(jl.credit) THEN SUM(jl.debit) - SUM(jl.credit) ELSE SUM(jl.credit) - SUM(jl.debit) END as amount
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE je.entry_type = 'opening_balance' AND je.status = 'posted'
  GROUP BY jl.account_id
) sub
WHERE a.id = sub.account_id
AND a.opening_balance = 0
AND a.account_name != 'Opening Balance Equity';