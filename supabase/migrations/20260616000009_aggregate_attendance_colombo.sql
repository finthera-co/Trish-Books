-- Phase E (anchored spec): aggregate_attendance_batch grouped on Asia/Colombo local date.
-- Sri Lankan biometric devices stamp local time; grouping on UTC date shifts late-evening
-- punches into the wrong day. Replaces the prior UTC version.
CREATE OR REPLACE FUNCTION public.aggregate_attendance_batch(p_batch_id uuid)
RETURNS TABLE(days_written int) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid; v_count int := 0;
  rec RECORD; p RECORD; v_shift RECORD;
  v_open timestamptz; v_worked numeric; v_toggle text; v_has_paired boolean;
  v_first timestamptz; v_last timestamptz; v_punch_count int;
  v_worked_hours numeric; v_ot numeric; v_late int; v_status text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.attendance_import_batches WHERE id = p_batch_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;

  FOR rec IN
    SELECT employee_id, (punch_at AT TIME ZONE 'Asia/Colombo')::date AS work_date
    FROM public.attendance_punches
    WHERE batch_id = p_batch_id AND employee_id IS NOT NULL
    GROUP BY employee_id, (punch_at AT TIME ZONE 'Asia/Colombo')::date
  LOOP
    SELECT ws.* INTO v_shift FROM public.work_shifts ws
      JOIN public.employees e ON e.shift_id = ws.id WHERE e.id = rec.employee_id;
    IF v_shift IS NULL THEN
      SELECT * INTO v_shift FROM public.work_shifts WHERE tenant_id = v_tenant AND is_default LIMIT 1;
    END IF;

    v_worked := 0; v_open := NULL; v_toggle := 'in'; v_has_paired := false;
    v_first := NULL; v_last := NULL; v_punch_count := 0;

    FOR p IN
      SELECT punch_at, direction FROM public.attendance_punches
      WHERE batch_id = p_batch_id AND employee_id = rec.employee_id
        AND (punch_at AT TIME ZONE 'Asia/Colombo')::date = rec.work_date
      ORDER BY punch_at
    LOOP
      v_punch_count := v_punch_count + 1;
      IF v_first IS NULL THEN v_first := p.punch_at; END IF;
      v_last := p.punch_at;
      IF p.direction IN ('in','out') THEN
        IF p.direction = 'in' THEN v_open := p.punch_at;
        ELSIF v_open IS NOT NULL THEN v_worked := v_worked + EXTRACT(EPOCH FROM (p.punch_at - v_open)); v_open := NULL; v_has_paired := true;
        END IF;
      ELSE
        IF v_toggle = 'in' THEN v_open := p.punch_at; v_toggle := 'out';
        ELSE
          IF v_open IS NOT NULL THEN v_worked := v_worked + EXTRACT(EPOCH FROM (p.punch_at - v_open)); v_open := NULL; v_has_paired := true; END IF;
          v_toggle := 'in';
        END IF;
      END IF;
    END LOOP;

    v_worked_hours := v_worked / 3600.0;
    IF NOT v_has_paired AND v_punch_count >= 2 THEN
      v_worked_hours := EXTRACT(EPOCH FROM (v_last - v_first)) / 3600.0;
    END IF;
    IF v_shift.break_minutes IS NOT NULL AND v_worked_hours > 0 AND v_punch_count <= 2 THEN
      v_worked_hours := GREATEST(0, v_worked_hours - v_shift.break_minutes / 60.0);
    END IF;
    v_ot := GREATEST(0, v_worked_hours - COALESCE(v_shift.ot_threshold_hours, 8));
    v_late := 0;
    IF v_first IS NOT NULL AND v_shift.start_time IS NOT NULL THEN
      v_late := GREATEST(0, (EXTRACT(EPOCH FROM ((v_first AT TIME ZONE 'Asia/Colombo')::time - v_shift.start_time)) - COALESCE(v_shift.late_grace_minutes,0)*60)::int / 60);
    END IF;
    v_status := CASE WHEN v_punch_count < 2 THEN 'half_day' ELSE 'present' END;

    INSERT INTO public.attendance_daily
      (tenant_id, employee_id, work_date, shift_id, first_in, last_out, worked_hours, ot_hours, late_minutes, status, source, batch_id, notes, updated_at)
    VALUES
      (v_tenant, rec.employee_id, rec.work_date, v_shift.id, v_first, v_last,
       ROUND(v_worked_hours,2), ROUND(v_ot,2), v_late, v_status, 'biometric', p_batch_id,
       CASE WHEN v_punch_count < 2 THEN 'Single punch — needs review' ELSE NULL END, now())
    ON CONFLICT (employee_id, work_date) DO UPDATE SET
      shift_id = EXCLUDED.shift_id, first_in = EXCLUDED.first_in, last_out = EXCLUDED.last_out,
      worked_hours = EXCLUDED.worked_hours, ot_hours = EXCLUDED.ot_hours, late_minutes = EXCLUDED.late_minutes,
      status = EXCLUDED.status, source = EXCLUDED.source, batch_id = EXCLUDED.batch_id, notes = EXCLUDED.notes, updated_at = now();
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.attendance_import_batches SET status = 'aggregated' WHERE id = p_batch_id;
  days_written := v_count; RETURN NEXT;
END; $$;
REVOKE ALL ON FUNCTION public.aggregate_attendance_batch(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.aggregate_attendance_batch(uuid) TO authenticated;
