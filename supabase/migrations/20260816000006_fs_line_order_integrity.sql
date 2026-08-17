-- Statement line ordering was corruptible, and had corrupted.
--
-- The mapping screen's up/down arrows swapped two lines by firing TWO
-- independent UPDATEs from the browser. Nothing made that pair atomic and
-- nothing stopped two lines sharing a sort_order, so a failed or interleaved
-- half left duplicates behind — and ORDER BY sort_order is then arbitrary.
-- Live consequence on tenant 375600ca: Revenue and Other Operating Income both
-- sat at 30, and the statement rendered Cost of Sales and GROSS PROFIT ABOVE
-- Revenue. A profit statement whose gross profit precedes its revenue is not a
-- cosmetic defect; it is not a statement.
--
-- Three parts: repair the existing data, make duplicates impossible, and move
-- the swap server-side so it is one atomic operation.

-- ── 1. Repair: restore the canonical sequence ───────────────────────────────
-- Only the statutory SOCI lines are renumbered, by line_code. Any line a
-- tenant added themselves keeps its relative position, renumbered after them.
WITH canonical(line_code, ord) AS (
  VALUES ('REVENUE', 10), ('COS', 20), ('GROSS_PROFIT', 30), ('OTHER_OP_INCOME', 40),
         ('SELLING_DIST', 50), ('ADMIN_EXP', 60), ('OPERATING_PROFIT', 70),
         ('FINANCE_EXP', 80), ('PBT', 90), ('TAX_EXP', 100), ('PROFIT_FOR_YEAR', 110),
         ('EPS', 120), ('BS_MEMO_GAP', 125), ('BS_MEMO_HEADING', 128)
),
ranked AS (
  -- Canonical lines take their fixed slot. Everything else — the memorandum
  -- lines and anything a tenant added — keeps its existing RELATIVE order and
  -- is renumbered into the 130+ band directly after the heading, so a
  -- deliberate reordering of those is preserved rather than overwritten.
  SELECT l.id, c.ord AS canon_ord,
         row_number() OVER (
           PARTITION BY l.statement_id, (c.ord IS NULL)
           ORDER BY l.sort_order, l.line_code
         ) AS rn
  FROM public.fs_lines l
  JOIN public.fs_statements s ON s.id = l.statement_id AND s.code = 'SOCI'
  LEFT JOIN canonical c ON c.line_code = l.line_code
)
UPDATE public.fs_lines l
SET sort_order = COALESCE(r.canon_ord, 120 + r.rn * 10)
FROM ranked r
WHERE r.id = l.id AND l.sort_order <> COALESCE(r.canon_ord, 120 + r.rn * 10);

-- Anything still colliding (custom lines, other statements) is spread out
-- deterministically rather than left ambiguous.
WITH dedup AS (
  SELECT l.id,
         row_number() OVER (PARTITION BY l.statement_id ORDER BY l.sort_order, l.line_code) * 10 AS new_ord,
         count(*) OVER (PARTITION BY l.statement_id, l.sort_order) AS dupes
  FROM public.fs_lines l
)
UPDATE public.fs_lines l
SET sort_order = d.new_ord
FROM dedup d
WHERE d.id = l.id AND d.dupes > 1;

-- ── 2. Make duplicates impossible ───────────────────────────────────────────
-- DEFERRABLE INITIALLY DEFERRED so an in-transaction swap may pass through a
-- transient collision; the constraint is checked once, at COMMIT.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fs_lines_statement_sort_unique') THEN
    ALTER TABLE public.fs_lines
      ADD CONSTRAINT fs_lines_statement_sort_unique UNIQUE (statement_id, sort_order)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- ── 3. One atomic move, server-side ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_fs_move_line(p_line_id uuid, p_direction text)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  v_stmt uuid; v_sort int; v_other_id uuid; v_other_sort int;
BEGIN
  IF p_direction NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'Direction must be up or down' USING ERRCODE = '22023';
  END IF;

  SELECT l.statement_id, l.sort_order INTO v_stmt, v_sort
  FROM public.fs_lines l WHERE l.id = p_line_id;
  IF v_stmt IS NULL THEN
    RAISE EXCEPTION 'No such statement line' USING ERRCODE = '42704';
  END IF;

  IF p_direction = 'up' THEN
    SELECT l.id, l.sort_order INTO v_other_id, v_other_sort
    FROM public.fs_lines l
    WHERE l.statement_id = v_stmt AND l.sort_order < v_sort
    ORDER BY l.sort_order DESC LIMIT 1;
  ELSE
    SELECT l.id, l.sort_order INTO v_other_id, v_other_sort
    FROM public.fs_lines l
    WHERE l.statement_id = v_stmt AND l.sort_order > v_sort
    ORDER BY l.sort_order ASC LIMIT 1;
  END IF;

  -- Already at the end: a no-op, not an error.
  IF v_other_id IS NULL THEN RETURN; END IF;

  UPDATE public.fs_lines SET sort_order = v_other_sort WHERE id = p_line_id;
  UPDATE public.fs_lines SET sort_order = v_sort       WHERE id = v_other_id;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_fs_move_line(uuid, text) TO authenticated;
