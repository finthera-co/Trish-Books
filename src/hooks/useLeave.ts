import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "cancelled" | "settled";

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

// ---- Types ----
export function useLeaveTypes() {
  return useQuery({
    queryKey: ["leave_types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leave_types").select("*").order("name");
      if (error) throw error; return data;
    },
  });
}
export function useUpsertLeaveType() {
  const qc = useQueryClient(); const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (t: any) => {
      const row = { ...t, tenant_id: appUser?.tenant_id };
      const { data, error } = t.id
        ? await supabase.from("leave_types").update(row).eq("id", t.id).select().single()
        : await supabase.from("leave_types").insert(row).select().single();
      if (error) throw error; return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["leave_types"] }); toast.success("Leave type saved"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---- Holidays ----
export function useHolidays() {
  return useQuery({
    queryKey: ["holidays"],
    queryFn: async () => {
      const { data, error } = await supabase.from("holidays").select("*").order("holiday_date");
      if (error) throw error; return data;
    },
  });
}
export function useCreateHoliday() {
  const qc = useQueryClient(); const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (h: { holiday_date: string; name: string; is_recurring?: boolean }) => {
      const { data, error } = await supabase.from("holidays").insert({ ...h, tenant_id: appUser?.tenant_id }).select().single();
      if (error) throw error; return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["holidays"] }); toast.success("Holiday added"); },
    onError: (e: Error) => toast.error(e.message),
  });
}
export function useDeleteHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("holidays").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["holidays"] }); toast.success("Holiday removed"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---- Balances ----
export function useLeaveBalances(year?: number) {
  const y = year ?? new Date().getFullYear();
  return useQuery({
    queryKey: ["leave_balances", y],
    queryFn: async () => {
      const { data, error } = await supabase.from("leave_balances")
        .select("*, leave_types(name, code, is_paid, color), employees(first_name, last_name, employee_number)")
        .eq("year", y);
      if (error) throw error; return data;
    },
  });
}
export function useAdjustLeaveBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, adjustment }: { id: string; adjustment: number }) => {
      const { error } = await supabase.from("leave_balances").update({ adjustment }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["leave_balances"] }); toast.success("Balance adjusted"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---- Requests ----
export function useLeaveRequests(status?: string) {
  return useQuery({
    queryKey: ["leave_requests", status ?? "all"],
    queryFn: async () => {
      let q = supabase.from("leave_requests")
        .select("*, leave_types(name, code, is_paid, color), employees(first_name, last_name, employee_number, user_id)")
        .order("created_at", { ascending: false });
      if (status && status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error; return data;
    },
  });
}
export function useCreateLeaveRequest() {
  const qc = useQueryClient(); const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (r: {
      employee_id: string; leave_type_id: string; start_date: string; end_date: string;
      is_half_day?: boolean; half_day_period?: string | null; reason?: string;
    }) => {
      const { data, error } = await supabase.from("leave_requests")
        .insert({ ...r, status: "pending", tenant_id: appUser?.tenant_id, created_by: appUser?.id })
        .select().single();
      if (error) throw error;
      writeAuditLog("Leave Requested", "leave_requests", data.id, { employee_id: r.employee_id });
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["leave_requests"] }); toast.success("Leave request submitted"); },
    onError: (e: Error) => toast.error(e.message),
  });
}
function rpcMutation(fn: string, msg: string, buildArgs: (v: any) => any) {
  return () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async (v: any) => {
        const { data, error } = await supabase.rpc(fn as any, buildArgs(v));
        if (error) throw error;
        if (data && (data as any).ok === false) throw new Error((data as any).error || "Action failed");
        return data;
      },
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["leave_requests"] });
        qc.invalidateQueries({ queryKey: ["leave_balances"] });
        toast.success(msg);
      },
      onError: (e: Error) => toast.error(e.message),
    });
  };
}
export const useApproveLeaveRequest = rpcMutation("approve_leave_request", "Leave approved", (id: string) => ({ p_request_id: id }));
export const useCancelLeaveRequest  = rpcMutation("cancel_leave_request",  "Leave cancelled", (id: string) => ({ p_request_id: id }));
export const useRejectLeaveRequest  = rpcMutation("reject_leave_request",  "Leave rejected",  (v: { id: string; reason: string }) => ({ p_request_id: v.id, p_reason: v.reason }));

// ---- For payroll: approved/settled leave days per employee within a period ----
export function useApprovedLeaveForPeriod(periodStart?: string, periodEnd?: string) {
  return useQuery({
    queryKey: ["approved_leave", periodStart, periodEnd],
    enabled: !!periodStart && !!periodEnd,
    queryFn: async (): Promise<Record<string, { paid_leave_days: number; unpaid_leave_days: number }>> => {
      const { data, error } = await supabase.from("leave_requests")
        .select("employee_id, days, status, start_date, end_date, leave_types(is_paid)")
        .in("status", ["approved", "settled"])
        .lte("start_date", periodEnd!).gte("end_date", periodStart!);
      if (error) throw error;
      const map: Record<string, { paid_leave_days: number; unpaid_leave_days: number }> = {};
      (data ?? []).forEach((r: any) => {
        const m = (map[r.employee_id] ??= { paid_leave_days: 0, unpaid_leave_days: 0 });
        if (r.leave_types?.is_paid) m.paid_leave_days += Number(r.days) || 0;
        else m.unpaid_leave_days += Number(r.days) || 0;
      });
      return map;
    },
  });
}
