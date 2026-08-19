-- ═══════════════════════════════════════════════════════════════════════════
-- Fix: new opening-balance entries silently dated "today" instead of the
-- tenant's actual conversion date, so they never appear as an Opening
-- Balance on any report (Trial Balance / General Ledger define "opening" as
-- everything strictly before the viewed range — an entry dated today is
-- never before any sensible range start, so it always lands as period
-- movement instead).
--
-- Root cause: /opening-balances (OpeningBalances.tsx) defaults its date field
-- to the tenant's `opening_balance_date` system_setting, falling back to
-- today only when that setting has never been saved. For at least one tenant
-- (14 posted opening_balance entries dated 2024-03-31), that setting was
-- never persisted — the setting-save path was added after their original
-- entries were made — so every entry added since defaults to "today".
-- Confirmed live: journal_entries 678a8cf4 (reference OB-3901, "Issued &
-- Fully paid Ordinary Shares") posted 2026-08-18 instead of 2024-03-31.
--
-- Fix, generically: backfill `opening_balance_date` for every tenant that
-- has posted opening_balance journal entries but no such setting yet, from
-- the earliest entry_date among them (the conversion date every other entry
-- already agrees on). This unblocks the form default for ALL future entries,
-- for any tenant in this situation — not just the one currently affected.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.system_settings (tenant_id, setting_key, setting_value)
SELECT je.tenant_id, 'opening_balance_date', MIN(je.entry_date)::text
FROM public.journal_entries je
WHERE je.entry_type = 'opening_balance' AND je.status = 'posted'
GROUP BY je.tenant_id
ON CONFLICT (tenant_id, setting_key) DO NOTHING;

-- ── Correct the one entry actually mis-dated by this bug ───────────────────
-- OB-3901 posted 2026-08-18 (today, at the time) instead of 2024-03-31, the
-- date every other opening-balance entry for this tenant uses. Re-dating it
-- moves it back into "opening" for any range starting on/after 2024-04-01,
-- matching every other account's opening balance.
UPDATE public.journal_entries
   SET entry_date = '2024-03-31'
 WHERE id = '678a8cf4-04cf-4598-81d4-70c7e2b65816'
   AND reference = 'OB-3901'
   AND entry_date = '2026-08-18';

-- ── Fix the account this entry created: wrong subtype, not "not appearing" ─
-- "Issued & Fully paid Ordinary Shares" (account 3901) was saved with
-- account_subtype = 'Opening Balance Equity' — the exact subtype string
-- account_is_obe() (below) uses to recognise the REAL Opening Balance Equity
-- account (3900). That's a share-capital account, not OBE; it just picked
-- the nearest-sounding option in a subtype list that has no "Share Capital"
-- entry. Correcting it to Owner's Equity, the closest existing fit.
UPDATE public.accounts
   SET account_subtype = 'Owner''s Equity'
 WHERE id = '89e15f7c-1b60-4c9f-b574-fa8303dc8899'
   AND account_code = '3901'
   AND account_subtype = 'Opening Balance Equity'
   AND is_system = false;

-- ── Harden account_is_obe(): require is_system, not just name/subtype text ─
-- Without this, ANY account a user happens to name "Opening Balance Equity"
-- or tag with that subtype (as just happened) is treated as THE tenant's OBE
-- account by account_opening_balance()/account_ledger_page() — its postings
-- get folded into "opening balance" or kept as raw transactions using the
-- real OBE account's special-cased rules, on an account that was never
-- provisioned as OBE. The genuine OBE account is always is_system = true
-- (ensure_obe_all_tenants); a user-created account never is that flag isn't
-- exposed in the Chart of Accounts UI. Code match still wins outright since
-- it's the one identifier that can never collide with anything else.
CREATE OR REPLACE FUNCTION public.account_is_obe(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT coalesce(bool_or(
           btrim(a.account_code) = '3900'
        OR (a.is_system AND (
              lower(btrim(a.account_name))    = 'opening balance equity'
           OR lower(btrim(a.account_subtype)) = 'opening balance equity'
           ))
         ), false)
  FROM public.accounts a
  WHERE a.id = p_account_id;
$$;
