
-- Drop the existing column and recreate as generated
ALTER TABLE public.fixed_assets DROP COLUMN IF EXISTS net_book_value;
ALTER TABLE public.fixed_assets ADD COLUMN net_book_value numeric GENERATED ALWAYS AS (cost - accumulated_depreciation) STORED;
