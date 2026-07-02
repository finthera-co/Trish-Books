import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type AttendanceStatus = "present" | "absent" | "half_day" | "paid_leave" | "unpaid_leave" | "holiday" | "weekend";

export interface AttendanceRecord {
  id: string;
  tenant_id: string;
  employee_id: string;
  attendance_date: string;
  status: AttendanceStatus;
  check_in_time: string | null;
  check_out_time: string | null;
  overtime_hours: number;
  leave_request_id: string | null;
  entry_source: string;
  notes: string | null;
  employees?: { first_name: string; last_name: string; department: string | null };
}

export interface AttendanceSummaryRow {
  employee_id: string;
  working_days: number;
  days_present: number;
  paid_leave_days: number;
  unpaid_absent_days: number;
  unmarked_days: number;
  overtime_hours: number;
}

// Helper: Write audit log
async function writeAuditLog(action: string, tableName: string, recordId?: string, details?: Record<string, any>) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const tenantId = await supabase.rpc("get_user_tenant_id");
    const userId = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
    await supabase.from("audit_logs").insert({
      action, table_name: tableName, record_id: recordId,
      user_id: userId.data?.id, tenant_id: tenantId.data, details: details || null,
    });
  } catch { /* silent */ }
}

/** month: "YYYY-MM" — fetches all attendance records for the tenant for that month */
export function useAttendanceRecords(month: string) {
  return useQuery({
    queryKey: ["attendance_records", month],
    queryFn: async () => {
      const start = `${month}-01`;
      const [y, m] = month.split("-").map(Number);
      const end = new Date(y, m, 0); // last day of month
      const endStr = `${month}-${String(end.getDate()).padStart(2, "0")}`;
      const { data, error } = await supabase
        .from("attendance_records")
        .select("*, employees(first_name, last_name, department)")
        .gte("attendance_date", start)
        .lte("attendance_date", endStr)
        .order("attendance_date");
      if (error) throw error;
      return data as unknown as AttendanceRecord[];
    },
    enabled: !!month,
  });
}

export function useUpsertAttendance() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (record: {
      employee_id: string;
      attendance_date: string;
      status: AttendanceStatus;
      check_in_time?: string | null;
      check_out_time?: string | null;
      overtime_hours?: number;
      notes?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("attendance_records")
        .upsert({
          tenant_id: appUser?.tenant_id,
          employee_id: record.employee_id,
          attendance_date: record.attendance_date,
          status: record.status,
          check_in_time: record.check_in_time || null,
          check_out_time: record.check_out_time || null,
          overtime_hours: record.overtime_hours || 0,
          notes: record.notes || null,
          entry_source: "manual",
          created_by: appUser?.id,
        }, { onConflict: "tenant_id,employee_id,attendance_date" })
        .select()
        .single();
      if (error) throw error;
      writeAuditLog("Attendance Marked", "attendance_records", data.id, {
        employee_id: record.employee_id, date: record.attendance_date, status: record.status,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance_records"] });
      qc.invalidateQueries({ queryKey: ["attendance_summary"] });
      toast.success("Attendance saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (record: { id: string; employee_id?: string; attendance_date?: string }) => {
      const { error } = await supabase.from("attendance_records").delete().eq("id", record.id);
      if (error) throw error;
      writeAuditLog("Attendance Cleared", "attendance_records", record.id, {
        employee_id: record.employee_id, date: record.attendance_date,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance_records"] });
      qc.invalidateQueries({ queryKey: ["attendance_summary"] });
      toast.success("Attendance cleared");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useBulkMarkAttendance() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      date: string;
      entries: { employee_id: string; status: AttendanceStatus; overtime_hours?: number }[];
    }) => {
      const rows = input.entries.map((e) => ({
        tenant_id: appUser?.tenant_id,
        employee_id: e.employee_id,
        attendance_date: input.date,
        status: e.status,
        overtime_hours: e.overtime_hours || 0,
        entry_source: "manual" as const,
        created_by: appUser?.id,
      }));
      const { error } = await supabase
        .from("attendance_records")
        .upsert(rows, { onConflict: "tenant_id,employee_id,attendance_date" });
      if (error) throw error;
      writeAuditLog("Bulk Attendance Marked", "attendance_records", undefined, {
        date: input.date, employee_count: input.entries.length,
      });
      return input.entries.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["attendance_records"] });
      qc.invalidateQueries({ queryKey: ["attendance_summary"] });
      toast.success(`Attendance saved for ${count} employee(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAttendanceSummary(periodStart?: string, periodEnd?: string) {
  return useQuery({
    queryKey: ["attendance_summary", periodStart, periodEnd],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_attendance_summary", {
        p_period_start: periodStart!,
        p_period_end: periodEnd!,
      });
      if (error) throw error;
      return (data || []) as AttendanceSummaryRow[];
    },
    enabled: !!periodStart && !!periodEnd,
  });
}

// ===== Holidays =====
export function useHolidays() {
  return useQuery({
    queryKey: ["holidays"],
    queryFn: async () => {
      const { data, error } = await supabase.from("holidays").select("*").order("holiday_date");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateHoliday() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (holiday: { holiday_date: string; name: string; is_recurring?: boolean }) => {
      const { data, error } = await supabase
        .from("holidays")
        .insert({ ...holiday, tenant_id: appUser?.tenant_id })
        .select()
        .single();
      if (error) throw error;
      writeAuditLog("Holiday Created", "holidays", data.id, { name: holiday.name, date: holiday.holiday_date });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holidays"] });
      qc.invalidateQueries({ queryKey: ["attendance_summary"] });
      toast.success("Holiday added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("holidays").delete().eq("id", id);
      if (error) throw error;
      writeAuditLog("Holiday Deleted", "holidays", id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holidays"] });
      qc.invalidateQueries({ queryKey: ["attendance_summary"] });
      toast.success("Holiday removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Periods locked by processed/finalized payroll runs — used to render read-only cells */
export function useLockedPayrollPeriods() {
  return useQuery({
    queryKey: ["locked_payroll_periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("period_start, period_end, status")
        .in("status", ["processed", "finalized"]);
      if (error) throw error;
      return (data || []) as { period_start: string; period_end: string; status: string }[];
    },
  });
}

export function isDateLocked(date: string, lockedPeriods?: { period_start: string; period_end: string }[]) {
  if (!lockedPeriods?.length) return false;
  return lockedPeriods.some((p) => date >= p.period_start && date <= p.period_end);
}

// ===== Biometric import pipeline (device profiles → batches → punches) =====

export function useDeviceProfiles() {
  return useQuery({
    queryKey: ["attendance_device_profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance_device_profiles").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveDeviceProfile() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (p: {
      name: string; file_format: string; column_mapping: any;
      has_separate_date_time: boolean; direction_mode: string;
      in_values: string[]; out_values: string[]; debounce_seconds: number;
      date_order: string;
    }) => {
      const { data, error } = await supabase.from("attendance_device_profiles")
        .insert({ ...p, tenant_id: appUser?.tenant_id }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attendance_device_profiles"] }); toast.success("Device profile saved"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Re-import guard: find batches whose period overlaps [start,end].
export function useOverlappingBatches(periodStart?: string, periodEnd?: string) {
  return useQuery({
    queryKey: ["attendance_overlap", periodStart, periodEnd],
    enabled: !!periodStart && !!periodEnd,
    queryFn: async () => {
      // overlap: existing.period_start <= end AND existing.period_end >= start
      const { data, error } = await supabase
        .from("attendance_import_batches")
        .select("id, file_name, period_start, period_end, total_rows, created_at")
        .lte("period_start", periodEnd!)
        .gte("period_end", periodStart!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

// Write a biometric_id back onto an employee (inline resolution).
export function useSetBiometricId() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, biometricId }: { employeeId: string; biometricId: string }) => {
      const { error } = await supabase.from("employees")
        .update({ biometric_id: biometricId }).eq("id", employeeId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employees"] }); toast.success("Linked device ID to employee"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAttendanceBatches() {
  return useQuery({
    queryKey: ["attendance_import_batches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance_import_batches").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

// Persists a parsed+matched batch. `rows` already mapped to {raw_device_id, punch_at, direction, raw_row, employee_id|null}
export function useImportPunches() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (args: {
      fileName: string; fileFormat: string; deviceProfileId?: string | null;
      periodStart?: string; periodEnd?: string;
      rows: { raw_device_id: string; punch_at: string; direction: string; raw_row: any; employee_id: string | null }[];
    }) => {
      const matched = args.rows.filter(r => r.employee_id).length;
      const { data: batch, error: bErr } = await supabase.from("attendance_import_batches").insert({
        tenant_id: appUser?.tenant_id, device_profile_id: args.deviceProfileId ?? null,
        file_name: args.fileName, period_start: args.periodStart ?? null, period_end: args.periodEnd ?? null,
        total_rows: args.rows.length, matched_rows: matched, unmatched_rows: args.rows.length - matched,
        status: "parsed", imported_by: appUser?.id,
      }).select().single();
      if (bErr) throw bErr;

      const punchRows = args.rows.map(r => ({
        tenant_id: appUser?.tenant_id, batch_id: batch.id,
        employee_id: r.employee_id, raw_device_id: r.raw_device_id,
        punch_at: r.punch_at, direction: r.direction,
        is_matched: !!r.employee_id, raw_row: r.raw_row,
      }));
      // chunk to stay under payload limits
      for (let i = 0; i < punchRows.length; i += 500) {
        const { error } = await supabase.from("attendance_punches").insert(punchRows.slice(i, i + 500));
        if (error) throw error;
      }
      return batch;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attendance_import_batches"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Per-employee totals from aggregated biometric attendance, reconciled against the
// expected working-day calendar (holidays excluded) and approved leave so absence
// is real, not "any day without a punch". Backed by rpc_period_attendance_summary;
// only employees with biometric data in the period appear in the map.
export interface AttendanceSummaryRow {
  worked_hours: number;
  ot_hours: number;          // normal OT hours
  holiday_ot_hours: number;  // rest-day / holiday hours (premium-rated)
  present_days: number;
  absent_days: number;       // expected − present − half − leave (floored at 0)
  half_days: number;
  expected_days: number;     // working days in period, Sundays + holidays excluded
  leave_days: number;        // approved/settled leave clipped to the period
  non_employed_days: number; // working days outside the employment window (unpaid, not absent)
  review_days: number;       // single-punch days flagged "needs review"
  undertime_minutes: number; // late minutes on worked days (for optional undertime policy)
  std_hours_per_day: number; // shift standard hours/day (for OT-rate derivation)
  ot_multiplier: number;     // shift normal OT multiplier
  holiday_ot_multiplier: number; // shift rest-day / holiday OT multiplier
  has_data: boolean;
}

export function useAttendanceSummaryForPeriod(periodStart?: string, periodEnd?: string) {
  return useQuery({
    // NOTE: distinct query key from useAttendanceSummary() above — that hook returns a
    // different shape from the manual-register RPC; sharing the key would corrupt the cache.
    queryKey: ["attendance_daily_summary", periodStart, periodEnd],
    enabled: !!periodStart && !!periodEnd,
    queryFn: async (): Promise<Record<string, AttendanceSummaryRow>> => {
      const { data, error } = await supabase.rpc("rpc_period_attendance_summary", {
        p_period_start: periodStart!,
        p_period_end: periodEnd!,
      });
      if (error) throw error;
      const map: Record<string, AttendanceSummaryRow> = {};
      ((data as any[]) ?? []).forEach((d) => {
        map[d.employee_id] = {
          worked_hours: Number(d.worked_hours) || 0,
          ot_hours: Number(d.ot_hours) || 0,
          holiday_ot_hours: Number(d.holiday_ot_hours) || 0,
          present_days: Number(d.present_days) || 0,
          absent_days: Number(d.absent_days) || 0,
          half_days: Number(d.half_days) || 0,
          expected_days: Number(d.expected_days) || 0,
          leave_days: Number(d.leave_days) || 0,
          non_employed_days: Number(d.non_employed_days) || 0,
          review_days: Number(d.review_days) || 0,
          undertime_minutes: Number(d.undertime_minutes) || 0,
          std_hours_per_day: Number(d.std_hours_per_day) || 8,
          ot_multiplier: Number(d.ot_multiplier) || 1.5,
          holiday_ot_multiplier: Number(d.holiday_ot_multiplier) || 2.0,
          has_data: true,
        };
      });
      return map;
    },
  });
}

// Standard working days in [start,end] — Mon–Sat by default (Sri Lanka 6-day week is common).
export function workingDaysInPeriod(periodStart: string, periodEnd: string, workingDows = [1, 2, 3, 4, 5, 6]) {
  const s = new Date(periodStart), e = new Date(periodEnd);
  let n = 0;
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    if (workingDows.includes(d.getDay())) n++;
  }
  return Math.max(n, 1);
}

// Trigger Phase 8 aggregation for a committed batch
export function useAggregateBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      const { data, error } = await supabase.rpc("aggregate_attendance_batch", { p_batch_id: batchId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Aggregation also mirrors into attendance_records (the register grid) — refresh those views too.
      qc.invalidateQueries({ queryKey: ["attendance_daily"] });
      qc.invalidateQueries({ queryKey: ["attendance_records"] });
      qc.invalidateQueries({ queryKey: ["attendance_summary"] });
      qc.invalidateQueries({ queryKey: ["attendance_daily_summary"] });
      toast.success("Attendance aggregated and recorded in the register");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ===== Standard working hours (the tenant's default work shift) =====
// Overtime during biometric aggregation is computed as
//   ot_hours = worked_hours - work_shifts.ot_threshold_hours (fallback 8).
// Without a configured shift the threshold defaults to 8h; this lets each
// company set its own standard so OT — and the worked/OT hours fed into
// payroll Step 2 — match their policy.

export function useDefaultWorkShift() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["default_work_shift", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      // Prefer the explicit default; fall back to the oldest shift if none is flagged.
      const { data, error } = await supabase
        .from("work_shifts")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveStandardHours() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      standard_hours: number; break_minutes: number;
      ot_multiplier?: number; break_after_hours?: number;
      half_day_hours?: number; holiday_ot_multiplier?: number;
      ot_includes_allowances?: boolean; deduct_undertime?: boolean; ot_cap_hours?: number;
    }) => {
      const tenant = appUser?.tenant_id;
      if (!tenant) throw new Error("No tenant");
      // OT begins beyond the standard day, so the threshold mirrors standard hours.
      const fields: Record<string, number | boolean> = {
        standard_hours: input.standard_hours,
        ot_threshold_hours: input.standard_hours,
        break_minutes: input.break_minutes,
      };
      if (input.ot_multiplier != null) fields.ot_multiplier = input.ot_multiplier;
      if (input.break_after_hours != null) fields.break_after_hours = input.break_after_hours;
      if (input.half_day_hours != null) fields.half_day_hours = input.half_day_hours;
      if (input.holiday_ot_multiplier != null) fields.holiday_ot_multiplier = input.holiday_ot_multiplier;
      if (input.ot_includes_allowances != null) fields.ot_includes_allowances = input.ot_includes_allowances;
      if (input.deduct_undertime != null) fields.deduct_undertime = input.deduct_undertime;
      if (input.ot_cap_hours != null) fields.ot_cap_hours = input.ot_cap_hours;
      // One default shift per tenant (enforced by uq_work_shifts_one_default).
      const { data: existing } = await supabase
        .from("work_shifts")
        .select("id")
        .eq("tenant_id", tenant)
        .eq("is_default", true)
        .maybeSingle();
      if (existing) {
        const { error } = await supabase.from("work_shifts").update(fields).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("work_shifts")
          .insert({ tenant_id: tenant, name: "Standard", is_default: true, is_active: true, ...fields });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["default_work_shift"] });
      toast.success("Standard working hours saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Bulk link/unlink biometric IDs (the cold-start linking screen).
export function useBulkSetBiometricIds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (changes: { employeeId: string; biometricId: string | null }[]) => {
      // sequential to surface per-row unique violations clearly; volumes are small (staff count)
      const failures: { employeeId: string; message: string }[] = [];
      for (const c of changes) {
        const { error } = await supabase.from("employees")
          .update({ biometric_id: c.biometricId === "" ? null : c.biometricId })
          .eq("id", c.employeeId);
        if (error) failures.push({ employeeId: c.employeeId, message: error.message });
      }
      if (failures.length) {
        throw new Error(`${failures.length} row(s) failed — likely a duplicate Device ID. ${failures[0].message}`);
      }
      return { updated: changes.length };
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["employees"] }); toast.success(`Linked ${r.updated} employee(s)`); },
    onError: (e: Error) => toast.error(e.message),
  });
}
