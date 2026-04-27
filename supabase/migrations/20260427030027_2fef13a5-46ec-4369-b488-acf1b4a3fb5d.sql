CREATE OR REPLACE FUNCTION public.sync_petty_cash_to_transactions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status != 'approved') THEN
    DELETE FROM transactions WHERE source_type = 'petty_cash' AND source_id = NEW.id;

    INSERT INTO transactions (tenant_id, date, amount, type, account_id, category, description, source_type, source_id)
    VALUES (
      NEW.tenant_id,
      NEW.date,
      NEW.total_amount,
      'expense',
      NEW.petty_cash_account_id,
      'Petty Cash',
      'Petty cash voucher ' || NEW.voucher_number,
      'petty_cash',
      NEW.id
    );
  END IF;

  IF NEW.status IN ('draft', 'pending', 'reversed') AND TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    DELETE FROM transactions WHERE source_type = 'petty_cash' AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;