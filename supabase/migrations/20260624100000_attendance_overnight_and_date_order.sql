-- Attendance engine — correctness pass.
--
-- 1) date_order on device profiles: biometric exports carry no locale, so the
--    DMY/MDY/YMD order the front-end parses with is now saved per profile and
--    reused on the next import (default DMY for Sri Lanka).
--
-- 2) Overnight-shift-safe aggregation. The previous version grouped punches by
--    Asia/Colombo calendar date BEFORE pairing, so a night shift (IN 22:00,
--    OUT 06:00 next day) split into two broken half-days. This rewrite pairs
--    each employee's punches into IN→OUT sessions across midnight FIRST, then
--    attributes every session — and its closing punch — to the day the session
--    STARTED. A post-midnight OUT is folded back into the start day, so no
--    spurious half-day appears on the following morning.
--
-- Pairing also uses a single in/out cursor: an explicit direction is honoured,
-- and an unrecognised ("unknown") value falls back to alternating — no separate
-- desynced toggle. Everything downstream (break deduction, OT threshold, late
-- minutes, half-day status, the attendance_records mirror with its lock /
-- manual-edit / leave guards) is preserved unchanged.

ALTER TABLE public.attendance_device_profiles
  ADD COLUMN IF NOT EXISTS date_order text NOT NULL DEFAULT 'DMY';

CREATE OR REPLACE FUNCTION public.aggregate_attendance_batch(p_batch_id uuid)
RETURNS TABLE(days_written int) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid; v_imported_by uuid; v_count int := 0;
  emp RECORD; p RECORD; rec RECORD; v_shift RECORD;
  v_eff text; v_toggle text; v_open timestamptz; v_open_date date;
  v_worked_seconds numeric; v_worked_hours numeric; v_ot numeric; v_late int; v_status text;
BEGIN
  SELECT tenant_id, imported_by INTO v_tenant, v_imported_by
    FROM public.attendance_import_batches WHERE id = p_batch_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;

  -- Scratch: every punch tagged with the work_date it ultimately belongs to,
  -- and the worked seconds of each completed session keyed by its start day.
  DROP TABLE IF EXISTS _agg_punch_day;
  DROP TABLE IF EXISTS _agg_session;
  CREATE TEMP TABLE _agg_punch_day (employee_id uuid, work_date date, punch_at timestamptz) ON COMMIT DROP;
  CREATE TEMP TABLE _agg_session   (employee_id uuid, work_date date, seconds numeric) ON COMMIT DROP;

  -- Pass 1 — pair each employee's full punch stream into sessions (across midnight).
  FOR emp IN
    SELECT DISTINCT employee_id FROM public.attendance_punches
    WHERE batch_id = p_batch_id AND employee_id IS NOT NULL
  LOOP
    v_open := NULL; v_open_date := NULL; v_toggle := 'in';
    FOR p IN
      SELECT punch_at, direction FROM public.attendance_punches
      WHERE batch_id = p_batch_id AND employee_id = emp.employee_id
      ORDER BY punch_at
    LOOP
      IF p.direction IN ('in','out') THEN
        v_eff := p.direction;
      ELSE
        v_eff := v_toggle;
        v_toggle := CASE WHEN v_toggle = 'in' THEN 'out' ELSE 'in' END;
      END IF;

      IF v_eff = 'in' THEN
        -- Open a session; any previously-open IN with no OUT is abandoned (its
        -- punch row already counts toward its own day's fallback).
        v_open := p.punch_at;
        v_open_date := (p.punch_at AT TIME ZONE 'Asia/Colombo')::date;
        INSERT INTO _agg_punch_day VALUES (emp.employee_id, v_open_date, p.punch_at);
      ELSE
        IF v_open IS NOT NULL THEN
          INSERT INTO _agg_session VALUES (emp.employee_id, v_open_date, EXTRACT(EPOCH FROM (p.punch_at - v_open)));
          -- Fold the closing OUT back onto the session's start day.
          INSERT INTO _agg_punch_day VALUES (emp.employee_id, v_open_date, p.punch_at);
          v_open := NULL; v_open_date := NULL;
        ELSE
          -- Lone OUT with nothing open — keep it on its own day.
          INSERT INTO _agg_punch_day VALUES (emp.employee_id, (p.punch_at AT TIME ZONE 'Asia/Colombo')::date, p.punch_at);
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- Pass 2 — per (employee, work_date), compute hours / OT / late and write out.
  FOR rec IN
    SELECT employee_id, work_date,
           min(punch_at) AS first_in, max(punch_at) AS last_out, count(*)::int AS punch_count
    FROM _agg_punch_day
    GROUP BY employee_id, work_date
  LOOP
    SELECT ws.* INTO v_shift FROM public.work_shifts ws
      JOIN public.employees e ON e.shift_id = ws.id WHERE e.id = rec.employee_id;
    IF v_shift IS NULL THEN
      SELECT * INTO v_shift FROM public.work_shifts WHERE tenant_id = v_tenant AND is_default LIMIT 1;
    END IF;

    SELECT COALESCE(sum(seconds), 0) INTO v_worked_seconds
      FROM _agg_session WHERE employee_id = rec.employee_id AND work_date = rec.work_date;

    v_worked_hours := v_worked_seconds / 3600.0;
    -- No paired session but ≥2 punches → fall back to span (first→last) of the day.
    IF v_worked_seconds <= 0 AND rec.punch_count >= 2 THEN
      v_worked_hours := EXTRACT(EPOCH FROM (rec.last_out - rec.first_in)) / 3600.0;
    END IF;
    -- Single IN/OUT pair never captures the lunch break, so deduct it; multiple
    -- punches mean they clocked out for it already.
    IF v_shift.break_minutes IS NOT NULL AND v_worked_hours > 0 AND rec.punch_count <= 2 THEN
      v_worked_hours := GREATEST(0, v_worked_hours - v_shift.break_minutes / 60.0);
    END IF;
    v_ot := GREATEST(0, v_worked_hours - COALESCE(v_shift.ot_threshold_hours, 8));
    v_late := 0;
    IF rec.first_in IS NOT NULL AND v_shift.start_time IS NOT NULL THEN
      v_late := GREATEST(0, (EXTRACT(EPOCH FROM ((rec.first_in AT TIME ZONE 'Asia/Colombo')::time - v_shift.start_time)) - COALESCE(v_shift.late_grace_minutes,0)*60)::int / 60);
    END IF;
    v_status := CASE WHEN rec.punch_count < 2 THEN 'half_day' ELSE 'present' END;

    INSERT INTO public.attendance_daily
      (tenant_id, employee_id, work_date, shift_id, first_in, last_out, worked_hours, ot_hours, late_minutes, status, source, batch_id, notes, updated_at)
    VALUES
      (v_tenant, rec.employee_id, rec.work_date, v_shift.id, rec.first_in, rec.last_out,
       ROUND(v_worked_hours,2), ROUND(v_ot,2), v_late, v_status, 'biometric', p_batch_id,
       CASE WHEN rec.punch_count < 2 THEN 'Single punch — needs review' ELSE NULL END, now())
    ON CONFLICT (employee_id, work_date) DO UPDATE SET
      shift_id = EXCLUDED.shift_id, first_in = EXCLUDED.first_in, last_out = EXCLUDED.last_out,
      worked_hours = EXCLUDED.worked_hours, ot_hours = EXCLUDED.ot_hours, late_minutes = EXCLUDED.late_minutes,
      status = EXCLUDED.status, source = EXCLUDED.source, batch_id = EXCLUDED.batch_id, notes = EXCLUDED.notes, updated_at = now();

    -- Mirror into the manual register so the Monthly Grid reflects the import.
    -- Skip locked days (the BEFORE trigger on attendance_records would abort the batch).
    IF NOT public.is_attendance_period_locked(v_tenant, rec.work_date) THEN
      INSERT INTO public.attendance_records
        (tenant_id, employee_id, attendance_date, status, check_in_time, check_out_time,
         overtime_hours, entry_source, notes, created_by)
      VALUES
        (v_tenant, rec.employee_id, rec.work_date, v_status,
         (rec.first_in AT TIME ZONE 'Asia/Colombo')::time,
         (rec.last_out AT TIME ZONE 'Asia/Colombo')::time,
         ROUND(v_ot,2), 'import',
         CASE WHEN rec.punch_count < 2 THEN 'Single punch — needs review' ELSE NULL END,
         v_imported_by)
      ON CONFLICT (tenant_id, employee_id, attendance_date) DO UPDATE SET
        status = EXCLUDED.status,
        check_in_time = EXCLUDED.check_in_time,
        check_out_time = EXCLUDED.check_out_time,
        overtime_hours = EXCLUDED.overtime_hours,
        entry_source = 'import',
        notes = EXCLUDED.notes,
        updated_at = now()
      WHERE attendance_records.leave_request_id IS NULL
        AND attendance_records.entry_source <> 'manual';
    END IF;

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.attendance_import_batches SET status = 'aggregated' WHERE id = p_batch_id;
  days_written := v_count; RETURN NEXT;
END; $$;
REVOKE ALL ON FUNCTION public.aggregate_attendance_batch(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.aggregate_attendance_batch(uuid) TO authenticated;
