-- ============================================================
-- PHASE 8: aggregate_attendance_batch(batch_id)
--
-- NOTE: The original Phase 8 prompt SQL was truncated mid-function.
-- This implementation is reconstructed faithfully from the documented
-- aggregation semantics:
--   * punches ordered per employee/day
--   * known directions -> sum in->out intervals; all-unknown -> alternating pairs
--   * worked_hours = paired interval sum minus shift break_minutes, deducted
--     ONLY when there is no explicit mid-day out/in pair (<=1 pair)
--   * ot_hours      = max(0, worked - ot_threshold_hours)
--   * late_minutes  = max(0, first_in - (shift.start_time + grace))
--   * shift resolves: employees.shift_id -> tenant default -> 8h / 09:00 fallback
--   * single-punch days -> half_day, worked_hours = 0, flagged in notes
-- ============================================================
CREATE OR REPLACE FUNCTION public.aggregate_attendance_batch(p_batch_id uuid)
RETURNS TABLE(days_written int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant       uuid;
  v_count        int := 0;
  rec            RECORD;   -- one employee/day group
  p              RECORD;   -- one punch
  v_shift        RECORD;
  v_open         timestamptz;
  v_worked       numeric;  -- seconds
  v_pairs        int;
  v_idx          int;
  v_first_in     timestamptz;
  v_last_out     timestamptz;
  v_punch_count  int;
  v_has_known    boolean;
  v_break_deduct numeric;
  v_start_time   time;
  v_grace        int;
  v_worked_hours numeric;
  v_ot           numeric;
  v_late         int;
  v_early        int;
  v_status       text;
  v_notes        text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.attendance_import_batches WHERE id = p_batch_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
  -- enforce caller tenant
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  FOR rec IN
    SELECT employee_id, (punch_at AT TIME ZONE 'UTC')::date AS work_date
    FROM public.attendance_punches
    WHERE batch_id = p_batch_id AND employee_id IS NOT NULL
    GROUP BY employee_id, (punch_at AT TIME ZONE 'UTC')::date
  LOOP
    -- ---- resolve shift: employee shift -> tenant default -> fallback ----
    SELECT ws.* INTO v_shift
    FROM public.employees e
    LEFT JOIN public.work_shifts ws ON ws.id = e.shift_id
    WHERE e.id = rec.employee_id;

    IF v_shift.id IS NULL THEN
      SELECT * INTO v_shift FROM public.work_shifts
      WHERE tenant_id = v_tenant AND is_default LIMIT 1;
    END IF;

    v_start_time := COALESCE(v_shift.start_time, TIME '09:00');
    v_grace      := COALESCE(v_shift.late_grace_minutes, 15);

    -- ---- day stats ----
    SELECT count(*), bool_or(direction IN ('in','out'))
      INTO v_punch_count, v_has_known
      FROM public.attendance_punches
      WHERE batch_id = p_batch_id AND employee_id = rec.employee_id
        AND (punch_at AT TIME ZONE 'UTC')::date = rec.work_date;

    SELECT min(punch_at), max(punch_at) INTO v_first_in, v_last_out
      FROM public.attendance_punches
      WHERE batch_id = p_batch_id AND employee_id = rec.employee_id
        AND (punch_at AT TIME ZONE 'UTC')::date = rec.work_date;

    v_worked := 0;
    v_pairs  := 0;
    v_open   := NULL;
    v_idx    := 0;
    v_notes  := NULL;

    IF v_has_known THEN
      -- sum in->out intervals
      FOR p IN
        SELECT punch_at, direction FROM public.attendance_punches
        WHERE batch_id = p_batch_id AND employee_id = rec.employee_id
          AND (punch_at AT TIME ZONE 'UTC')::date = rec.work_date
        ORDER BY punch_at
      LOOP
        IF p.direction = 'in' THEN
          v_open := p.punch_at;
        ELSIF p.direction = 'out' AND v_open IS NOT NULL THEN
          v_worked := v_worked + EXTRACT(EPOCH FROM (p.punch_at - v_open));
          v_pairs  := v_pairs + 1;
          v_open   := NULL;
        END IF;
      END LOOP;
      -- first_in = first 'in' punch (fallback to first punch)
      SELECT min(punch_at) INTO v_first_in FROM public.attendance_punches
        WHERE batch_id = p_batch_id AND employee_id = rec.employee_id
          AND (punch_at AT TIME ZONE 'UTC')::date = rec.work_date AND direction = 'in';
      IF v_first_in IS NULL THEN
        SELECT min(punch_at) INTO v_first_in FROM public.attendance_punches
          WHERE batch_id = p_batch_id AND employee_id = rec.employee_id
            AND (punch_at AT TIME ZONE 'UTC')::date = rec.work_date;
      END IF;
    ELSE
      -- inferred alternating: (1=in,2=out),(3=in,4=out)...
      FOR p IN
        SELECT punch_at FROM public.attendance_punches
        WHERE batch_id = p_batch_id AND employee_id = rec.employee_id
          AND (punch_at AT TIME ZONE 'UTC')::date = rec.work_date
        ORDER BY punch_at
      LOOP
        v_idx := v_idx + 1;
        IF v_idx % 2 = 1 THEN
          v_open := p.punch_at;
        ELSE
          v_worked := v_worked + EXTRACT(EPOCH FROM (p.punch_at - v_open));
          v_pairs  := v_pairs + 1;
          v_open   := NULL;
        END IF;
      END LOOP;
    END IF;

    -- deduct break only when there is no explicit mid-day out/in pair
    v_break_deduct := CASE WHEN v_pairs <= 1 THEN COALESCE(v_shift.break_minutes, 60) ELSE 0 END;
    v_worked_hours := GREATEST(0, (v_worked / 3600.0) - (v_break_deduct / 60.0));

    IF v_punch_count = 1 THEN
      v_status       := 'half_day';
      v_worked_hours := 0;
      v_notes        := 'Single punch — needs review';
    ELSE
      v_status := 'present';
    END IF;

    v_ot := GREATEST(0, v_worked_hours - COALESCE(v_shift.ot_threshold_hours, 8));

    -- lateness vs shift start + grace
    v_late := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (
      (v_first_in AT TIME ZONE 'UTC')::time - (v_start_time + make_interval(mins => v_grace))
    )) / 60.0))::int;

    -- early leave vs shift end (0 when no shift end defined)
    v_early := 0;
    IF v_shift.end_time IS NOT NULL AND v_last_out IS NOT NULL THEN
      v_early := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (
        v_shift.end_time - (v_last_out AT TIME ZONE 'UTC')::time
      )) / 60.0))::int;
    END IF;

    INSERT INTO public.attendance_daily AS ad
      (tenant_id, employee_id, work_date, shift_id, first_in, last_out,
       worked_hours, ot_hours, late_minutes, early_leave_minutes,
       status, source, batch_id, notes, updated_at)
    VALUES
      (v_tenant, rec.employee_id, rec.work_date, v_shift.id, v_first_in, v_last_out,
       round(v_worked_hours, 2), round(v_ot, 2), v_late, v_early,
       v_status, 'biometric', p_batch_id, v_notes, now())
    ON CONFLICT (employee_id, work_date) DO UPDATE SET
      shift_id            = EXCLUDED.shift_id,
      first_in            = EXCLUDED.first_in,
      last_out            = EXCLUDED.last_out,
      worked_hours        = EXCLUDED.worked_hours,
      ot_hours            = EXCLUDED.ot_hours,
      late_minutes        = EXCLUDED.late_minutes,
      early_leave_minutes = EXCLUDED.early_leave_minutes,
      status              = EXCLUDED.status,
      source              = EXCLUDED.source,
      batch_id            = EXCLUDED.batch_id,
      notes               = EXCLUDED.notes,
      updated_at          = now();

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.attendance_import_batches SET status = 'aggregated' WHERE id = p_batch_id;

  days_written := v_count;
  RETURN NEXT;
END;
$$;
