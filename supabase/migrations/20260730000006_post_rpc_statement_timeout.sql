-- ═══════════════════════════════════════════════════════════════════════════
-- Give the bank-import posting RPC room to finish a large month.
--
-- import_bank_statement_post() posts a whole month as one atomic transaction
-- (thousands of journal entries + lines + balance/reconciliation checks). On big
-- months (e.g. 6,905 rows) that exceeded the connection's default
-- statement_timeout and was cancelled (57014) — the batch failed and, worse,
-- left its period claim active. Pin a generous per-statement timeout on the
-- function so a legitimately large post completes; the edge function's own wall
-- clock remains the outer bound. get_or_create_derived_accounts gets the same,
-- since it runs just before posting in the same flow.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER FUNCTION public.import_bank_statement_post(uuid, uuid)
  SET statement_timeout = '180s';

ALTER FUNCTION public.get_or_create_derived_accounts(uuid, uuid, jsonb)
  SET statement_timeout = '120s';
