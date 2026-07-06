-- Shim: define log_audit_event() as a no-op BEFORE the trigger that references it.
-- The real implementation is installed by migration 20260309041755 via CREATE OR REPLACE.
-- This resolves a timestamp-ordering bug where the audit trigger was created one minute
-- before the function it depends on.
CREATE OR REPLACE FUNCTION public.log_audit_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NULL;
END;
$$;
