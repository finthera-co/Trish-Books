-- ═══════════════════════════════════════════════════════════════════════════
-- Release the period claim when a bank-import batch FAILS.
--
-- claim_bank_statement_periods() inserts an ACTIVE row into
-- bank_statement_batch_periods BEFORE the lines are inserted / the batch is
-- posted. If posting then fails, the batch is marked 'failed' but its claim was
-- left ACTIVE — so re-importing that month hit "PERIOD_ALREADY_IMPORTED", held
-- by a dead (failed) batch that undo can't reach (undo only touches 'posted').
--
-- This trigger deactivates a batch's claims the moment it becomes 'failed',
-- covering every failure path (insert error, posting error, edge timeout),
-- so a failed month is always immediately re-importable.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.release_claims_on_batch_fail()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'failed' AND OLD.status IS DISTINCT FROM 'failed' THEN
    UPDATE public.bank_statement_batch_periods
       SET is_active = false
     WHERE batch_id = NEW.id AND is_active;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_claims_on_batch_fail ON public.bank_statement_batches;
CREATE TRIGGER trg_release_claims_on_batch_fail
  AFTER UPDATE OF status ON public.bank_statement_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.release_claims_on_batch_fail();
