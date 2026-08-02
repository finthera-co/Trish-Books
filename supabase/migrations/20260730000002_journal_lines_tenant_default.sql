-- Follow-up to 20260729000008, which added journal_lines.tenant_id NOT NULL.
--
-- Two problems with how that landed:
--
-- 1. NOT NULL with no default makes the column *required* in the generated
--    TypeScript Insert type, so every existing insert site stopped type-checking
--    (16 errors) even though the trigger fills the value. A default fixes the
--    typing and matches what actually happens.
--
-- 2. The trigger only fired WHEN NEW.tenant_id IS NULL, so a caller could supply a
--    tenant_id that disagreed with the parent entry's. journal_lines RLS is now
--    `tenant_id = get_user_tenant_id()`, which means a mismatched value would be a
--    line filed under one tenant hanging off another tenant's entry. The parent is
--    the only authority on which tenant a line belongs to, so derive it always.

-- Default keeps the common authenticated path cheap and makes the column optional
-- in the generated types. It is a fallback, not the authority — see the trigger.
ALTER TABLE public.journal_lines
  ALTER COLUMN tenant_id SET DEFAULT public.get_user_tenant_id();

-- Always derive from the parent entry, so a line's tenant can never disagree with
-- the entry it belongs to, whoever is inserting and whatever they pass.
CREATE OR REPLACE FUNCTION public.fn_journal_lines_set_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT je.tenant_id INTO NEW.tenant_id
  FROM public.journal_entries je
  WHERE je.id = NEW.journal_entry_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_lines_set_tenant ON public.journal_lines;
CREATE TRIGGER trg_journal_lines_set_tenant
  BEFORE INSERT OR UPDATE OF journal_entry_id ON public.journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_journal_lines_set_tenant();
