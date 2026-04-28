CREATE OR REPLACE FUNCTION public.block_posted_payment_voucher_edits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'Cannot delete posted payment voucher %. Create a reversal instead.', OLD.voucher_number;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'posted' THEN
    -- Allow only status transition to reversed/voided, or remaining posted.
    IF NEW.status NOT IN ('posted','reversed','voided') THEN
      RAISE EXCEPTION 'Posted payment voucher % can only be reversed/voided.', OLD.voucher_number;
    END IF;

    -- While the voucher remains posted, allow exactly one system linkage of journal_entry_id
    -- after creation. All other accounting-critical fields remain immutable.
    IF NEW.status = 'posted' AND (
         NEW.voucher_number       IS DISTINCT FROM OLD.voucher_number
      OR NEW.payment_account_id   IS DISTINCT FROM OLD.payment_account_id
      OR NEW.total_amount         IS DISTINCT FROM OLD.total_amount
      OR NEW.payment_date         IS DISTINCT FROM OLD.payment_date
      OR NEW.tenant_id            IS DISTINCT FROM OLD.tenant_id
      OR (
           OLD.journal_entry_id IS NOT NULL
           AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
         )
      OR (
           OLD.journal_entry_id IS NULL
           AND NEW.journal_entry_id IS NULL
         )
    ) THEN
      RAISE EXCEPTION 'Posted payment voucher % is immutable. Reverse and re-issue to make changes.', OLD.voucher_number;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;