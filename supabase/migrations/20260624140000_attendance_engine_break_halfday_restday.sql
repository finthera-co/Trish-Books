-- Phases 2 & 3 — attendance engine accuracy: exact break, hours-based status,
-- and rest-day / holiday premium OT. Both rewrite Pass 2 of the aggregator, so
-- they ship together.
--
--  • Break (Phase 2): instead of "≤2 punches ⇒ deduct an hour", the break is
--    gap-aware. Time the employee was punched OUT during the day (gaps between
--    sessions) already excludes their lunch, so we only deduct the SHORTFALL of
--    the configured break not already taken — and only on a substantial day
--    (worked > break_after_hours). A clean 4h half-day is no longer docked an hour.
--
--  • Status (Phase 2): present vs half_day is decided on worked HOURS, not punch
--    count. < half_day_hours ⇒ half_day; a single punch stays half_day+review.
--
--  • Rest-day OT (Phase 3): work on a non-working weekday (shift.working_days) or
--    a public holiday is all premium — recorded in holiday_ot_hours and paid at
--    holiday_ot_multiplier, not the normal OT rate.

ALTER TABLE public.work_shifts
  ADD COLUMN IF NOT EXISTS break_after_hours    numeric NOT NULL DEFAULT 6,    -- deduct break only past this
  ADD COLUMN IF NOT EXISTS half_day_hours       numeric NOT NULL DEFAULT 4,    -- worked below this = half day
  ADD COLUMN IF NOT EXISTS holiday_ot_multiplier numeric NOT NULL DEFAULT 2.0; -- rest-day / holiday OT rate

ALTER TABLE public.attendance_daily
  ADD COLUMN IF NOT EXISTS holiday_ot_hours numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_rest_day      boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.aggregate_attendance_batch(p_batch_id uuid)
RETURNS TABLE(days_written int) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid; v_imported_by uuid; v_count int := 0;
  emp RECORD; p RECORD; rec RECORD; v_shift RECORD;
  v_eff text; v_toggle text; v_open timestamptz; v_open_date date;
  v_worked_seconds numeric; v_span_seconds numeric;
  v_gross_h numeric; v_gaps_h numeric; v_net_h numeric;
  v_break_after numeric; v_break_h numeric;
  v_ot numeric; v_holiday_ot numeric; v_late int; v_status text;
  v_is_rest boolean;
BEGIN
  SELECT tenant_id, imported_by INTO v_tenant, v_imported_by
    FROM public.attendance_import_batches WHERE id = p_batch_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;

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
        v_open := p.punch_at;
        v_open_date := (p.punch_at AT TIME ZONE 'Asia/Colombo')::date;
        INSERT INTO _agg_punch_day VALUES (emp.employee_id, v_open_date, p.punch_at);
      ELSE
        IF v_open IS NOT NULL THEN
          INSERT INTO _agg_session VALUES (emp.employee_id, v_open_date, EXTRACT(EPOCH FROM (p.punch_at - v_open)));
          INSERT INTO _agg_punch_day VALUES (emp.employee_id, v_open_date, p.punch_at);
          v_open := NULL; v_open_date := NULL;
        ELSE
          INSERT INTO _agg_punch_day VALUES (emp.employee_id, (p.punch_at AT TIME ZONE 'Asia/Colombo')::date, p.punch_at);
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- Pass 2 — per (employee, work_date): net worked, OT split, status.
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
    v_span_seconds := EXTRACT(EPOCH FROM (rec.last_out - rec.first_in));

    -- Gross clocked-in hours + already-taken unpaid gaps.
    IF v_worked_seconds > 0 THEN
      v_gross_h := v_worked_seconds / 3600.0;
      v_gaps_h  := GREATEST(0, v_span_seconds / 3600.0 - v_gross_h);
    ELSIF rec.punch_count >= 2 THEN
      v_gross_h := v_span_seconds / 3600.0;   -- unpaired fallback: treat the span as worked
      v_gaps_h  := 0;
    ELSE
      v_gross_h := 0; v_gaps_h := 0;
    END IF;

    -- Gap-aware break: only on a substantial day, only the part not already gapped out.
    v_break_after := COALESCE(v_shift.break_after_hours, 6);
    v_break_h     := COALESCE(v_shift.break_minutes, 0) / 60.0;
    IF v_gross_h > v_break_after THEN
      v_net_h := GREATEST(0, v_gross_h - GREATEST(0, v_break_h - v_gaps_h));
    ELSE
      v_net_h := v_gross_h;
    END IF;

    -- Rest day = a non-working weekday for the shift, or a public holiday.
    v_is_rest := (NOT (EXTRACT(DOW FROM rec.work_date)::int = ANY(COALESCE(v_shift.working_days, ARRAY[1,2,3,4,5,6]))))
      OR EXISTS (SELECT 1 FROM public.holidays h WHERE h.tenant_id = v_tenant
        AND (h.holiday_date = rec.work_date OR (h.is_recurring
          AND EXTRACT(MONTH FROM h.holiday_date) = EXTRACT(MONTH FROM rec.work_date)
          AND EXTRACT(DAY   FROM h.holiday_date) = EXTRACT(DAY   FROM rec.work_date))));

    IF v_is_rest THEN
      v_holiday_ot := v_net_h;   -- every hour on a rest day / holiday is premium
      v_ot := 0;
    ELSE
      v_holiday_ot := 0;
      v_ot := GREATEST(0, v_net_h - COALESCE(v_shift.ot_threshold_hours, 8));
    END IF;

    -- Status from worked hours, not punch count.
    IF rec.punch_count < 2 THEN
      v_status := 'half_day';                       -- single punch — needs review
    ELSIF v_is_rest THEN
      v_status := 'present';                        -- worked a rest day (not an expected day)
    ELSIF v_net_h <= 0 THEN
      v_status := 'absent';
    ELSIF v_net_h < COALESCE(v_shift.half_day_hours, 4) THEN
      v_status := 'half_day';
    ELSE
      v_status := 'present';
    END IF;

    v_late := 0;
    IF NOT v_is_rest AND rec.first_in IS NOT NULL AND v_shift.start_time IS NOT NULL THEN
      v_late := GREATEST(0, (EXTRACT(EPOCH FROM ((rec.first_in AT TIME ZONE 'Asia/Colombo')::time - v_shift.start_time)) - COALESCE(v_shift.late_grace_minutes,0)*60)::int / 60);
    END IF;

    INSERT INTO public.attendance_daily
      (tenant_id, employee_id, work_date, shift_id, first_in, last_out, worked_hours, ot_hours, holiday_ot_hours, is_rest_day, late_minutes, status, source, batch_id, notes, updated_at)
    VALUES
      (v_tenant, rec.employee_id, rec.work_date, v_shift.id, rec.first_in, rec.last_out,
       ROUND(v_net_h,2), ROUND(v_ot,2), ROUND(v_holiday_ot,2), v_is_rest, v_late, v_status, 'biometric', p_batch_id,
       CASE WHEN rec.punch_count < 2 THEN 'Single punch — needs review' ELSE NULL END, now())
    ON CONFLICT (employee_id, work_date) DO UPDATE SET
      shift_id = EXCLUDED.shift_id, first_in = EXCLUDED.first_in, last_out = EXCLUDED.last_out,
      worked_hours = EXCLUDED.worked_hours, ot_hours = EXCLUDED.ot_hours,
      holiday_ot_hours = EXCLUDED.holiday_ot_hours, is_rest_day = EXCLUDED.is_rest_day,
      late_minutes = EXCLUDED.late_minutes, status = EXCLUDED.status, source = EXCLUDED.source,
      batch_id = EXCLUDED.batch_id, notes = EXCLUDED.notes, updated_at = now();

    -- Mirror to the register (total OT = normal + holiday for the grid display).
    IF NOT public.is_attendance_period_locked(v_tenant, rec.work_date) THEN
      INSERT INTO public.attendance_records
        (tenant_id, employee_id, attendance_date, status, check_in_time, check_out_time,
         overtime_hours, entry_source, notes, created_by)
      VALUES
        (v_tenant, rec.employee_id, rec.work_date, v_status,
         (rec.first_in AT TIME ZONE 'Asia/Colombo')::time,
         (rec.last_out AT TIME ZONE 'Asia/Colombo')::time,
         ROUND(v_ot + v_holiday_ot, 2), 'import',
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
