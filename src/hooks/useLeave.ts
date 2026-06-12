import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveType {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  is_paid: boolean;
  annual_entitlement: number;
  requires_approval: boolean;
  is_active: boolean;
}

export interface LeaveRequest {
  id: string;
  tenant_id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  is_half_day: boolean;
  reason: string | null;
  status: LeaveRequestStatus;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  employees?: { first_name: string; last_name: string; department: string | null };
  leave_types?: { name: string; code: string; is_paid: boolean };
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

function invalidateLeaveQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["leave_requests"] });
  qc.invalidateQueries({ queryKey: ["attendance_records"] });
  qc.invalidateQueries({ queryKey: ["attendance_summary"] });
  qc.invalidateQueries({ queryKey: ["employees"] });
}

export function useLeaveTypes() {
  return useQuery({
    queryKey: ["leave_types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_types")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as LeaveType[];
    },
  });
}

export function useCreateLeaveType() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (type: { name: string; code: string; is_paid: boolean; annual_entitlement: number }) => {
      const { data, error } = await supabase
        .from("leave_types")
        .insert({ ...type, tenant_id: appUser?.tenant_id })
        .select()
        .single();
      if (error) throw error;
      writeAuditLog("Leave Type Created", "leave_types", data.id, { name: type.name, code: type.code });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave_types"] });
      toast.success("Leave type created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateLeaveType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; is_paid?: boolean; annual_entitlement?: number; is_active?: boolean }) => {
      const { error } = await supabase.from("leave_types").update(updates).eq("id", id);
      if (error) throw error;
      writeAuditLog("Leave Type Updated", "leave_types", id, updates);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave_types"] });
      toast.success("Leave type updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useLeaveRequests(statusFilter?: LeaveRequestStatus) {
  return useQuery({
    queryKey: ["leave_requests", statusFilter || "all"],
    queryFn: async () => {
      let query = supabase
        .from("leave_requests")
        .select("*, employees(first_name, last_name, department), leave_types(name, code, is_paid)")
        .order("created_at", { ascending: false });
      if (statusFilter) query = query.eq("status", statusFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as LeaveRequest[];
    },
  });
}

export function useCreateLeaveRequest() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (request: {
      employee_id: string;
      leave_type_id: string;
      start_date: string;
      end_date: string;
      days: number;
      is_half_day?: boolean;
      reason?: string;
    }) => {
      const { data, error } = await supabase
        .from("leave_requests")
        .insert({
          ...request,
          is_half_day: request.is_half_day || false,
          tenant_id: appUser?.tenant_id,
          created_by: appUser?.id,
        })
        .select()
        .single();
      if (error) throw error;
      writeAuditLog("Leave Request Created", "leave_requests", data.id, {
        employee_id: request.employee_id, days: request.days,
        start_date: request.start_date, end_date: request.end_date,
      });
      return data;
    },
    onSuccess: () => {
      invalidateLeaveQueries(qc);
      toast.success("Leave request created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useApproveLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc("approve_leave_request", { p_request_id: requestId });
      if (error) throw error;
      writeAuditLog("Leave Request Approved", "leave_requests", requestId);
    },
    onSuccess: () => {
      invalidateLeaveQueries(qc);
      toast.success("Leave approved — attendance register updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRejectLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, reason }: { requestId: string; reason: string }) => {
      const { error } = await supabase.rpc("reject_leave_request", {
        p_request_id: requestId,
        p_reason: reason,
      });
      if (error) throw error;
      writeAuditLog("Leave Request Rejected", "leave_requests", requestId, { reason });
    },
    onSuccess: () => {
      invalidateLeaveQueries(qc);
      toast.success("Leave request rejected");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCancelLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc("cancel_leave_request", { p_request_id: requestId });
      if (error) throw error;
      writeAuditLog("Leave Request Cancelled", "leave_requests", requestId);
    },
    onSuccess: () => {
      invalidateLeaveQueries(qc);
      toast.success("Leave request cancelled — balance restored");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
