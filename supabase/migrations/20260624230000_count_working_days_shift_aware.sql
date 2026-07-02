-- Gap 7 — count_working_days respects the tenant's working-day pattern.
-- It hardcoded "exclude Sundays" (a 6-day week). Now it derives the working
-- weekdays from the tenant's DEFAULT shift working_days[] (0=Sun … 6=Sat), so a
-- 5-day-week tenant gets a 5-day denominator. Falls back to Mon–Sat, which is
-- identical to the previous behaviour for every existing tenant. Used by both the
-- expected-days denominator and leave counting, so they stay consistent.
CREATE OR REPLACE FUNCTION public.count_working_days(
  p_tenant_id uuid, p_start date, p_end date, p_is_half_day boolean DEFAULT false
) RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_count numeric := 0; d date; v_dows int[];
BEGIN
  SELECT working_days INTO v_dows
    FROM public.work_shifts WHERE tenant_id = p_tenant_id AND is_default LIMIT 1;
  v_dows := COALESCE(v_dows, ARRAY[1,2,3,4,5,6]); -- Mon–Sat default

  IF p_is_half_day AND p_start = p_end THEN
    IF EXTRACT(DOW FROM p_start)::int = ANY(v_dows)
       AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.tenant_id = p_tenant_id
         AND (h.holiday_date = p_start OR (h.is_recurring
           AND EXTRACT(MONTH FROM h.holiday_date)=EXTRACT(MONTH FROM p_start)
           AND EXTRACT(DAY FROM h.holiday_date)=EXTRACT(DAY FROM p_start))))
    THEN RETURN 0.5; ELSE RETURN 0; END IF;
  END IF;
  d := p_start;
  WHILE d <= p_end LOOP
    IF EXTRACT(DOW FROM d)::int = ANY(v_dows)
       AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.tenant_id = p_tenant_id
         AND (h.holiday_date = d OR (h.is_recurring
           AND EXTRACT(MONTH FROM h.holiday_date)=EXTRACT(MONTH FROM d)
           AND EXTRACT(DAY FROM h.holiday_date)=EXTRACT(DAY FROM d))))
    THEN v_count := v_count + 1; END IF;
    d := d + 1;
  END LOOP;
  RETURN v_count;
END; $$;
