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

// Per-employee totals from aggregated biometric attendance (attendance_daily),
// used to feed hours/OT into a payroll run. NOTE: distinct query key from
// useAttendanceSummary() above — that hook returns a different shape from the
// manual-register RPC; sharing the key would corrupt the React Query cache.
export function useAttendanceSummaryForPeriod(periodStart?: string, periodEnd?: string) {
  return useQuery({
    queryKey: ["attendance_daily_summary", periodStart, periodEnd],
    enabled: !!periodStart && !!periodEnd,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_daily")
        .select("employee_id, worked_hours, ot_hours, status")
        .gte("work_date", periodStart!)
        .lte("work_date", periodEnd!);
      if (error) throw error;
      // reduce to per-employee totals
      const map: Record<string, { worked: number; ot: number; absent: number; present: number }> = {};
      (data ?? []).forEach((d: any) => {
        const m = (map[d.employee_id] ??= { worked: 0, ot: 0, absent: 0, present: 0 });
        m.worked += Number(d.worked_hours) || 0;
        m.ot += Number(d.ot_hours) || 0;
        if (d.status === "absent") m.absent += 1; else m.present += 1;
      });
      return map;
    },
  });
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attendance_daily"] }); toast.success("Attendance aggregated"); },
    onError: (e: Error) => toast.error(e.message),
  });
}
