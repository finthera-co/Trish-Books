CREATE OR REPLACE FUNCTION public.block_posted_payment_voucher_lines()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  -- Allow initial INSERTs even if voucher is already 'posted' (RPC creates voucher then lines).
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_status FROM payment_vouchers
  WHERE id = COALESCE(NEW.voucher_id, OLD.voucher_id);

  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'Cannot modify lines of a posted payment voucher.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;