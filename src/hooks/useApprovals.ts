// ─────────────────────────────────────────────────────────────────────────────
// useApprovals.ts
// Invoice approval chain: inbox queue, per-invoice trail, and the three
// decisions (approve / request changes / reject) plus resubmit and comment.
// ─────────────────────────────────────────────────────────────────────────────

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ApprovalAction =
  | "submitted" | "resubmitted" | "approved" | "rejected" | "changes_requested" | "comment";

export interface ApprovalStep {
  name: string;
  min_amount: number;
  required_approvals: number;
  approver_ids: string[];
}

export interface ApprovalQueueRow {
  id: string;
  invoice_number: string;
  customer_name: string | null;
  total_amount: number;
  currency: string;
  base_amount: number;
  issue_date: string | null;
  due_date: string | null;
  approval_status: "pending" | "changes_requested" | "rejected";
  approval_step: number;
  approval_steps_total: number;
  step_name: string | null;
  required_approvals: number;
  approvals_count: number;
  created_at: string;
  created_by_name: string | null;
  is_mine: boolean;
  can_act: boolean;
  already_approved: boolean;
  block_reason: string | null;
  waiting_on: string[];
  last_event_at: string | null;
  comment_count: number;
}

export interface ApprovalEvent {
  id: string;
  action: ApprovalAction;
  note: string | null;
  amount_base: number | null;
  step_index: number | null;
  step_name: string | null;
  created_at: string;
  invoice_id: string;
  invoices?: { invoice_number: string } | null;
  users?: { first_name: string | null; last_name: string | null; email: string | null } | null;
}

export const actorName = (u?: ApprovalEvent["users"]) =>
  u ? ([u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || "Someone") : "System";

// ─── Queue ───────────────────────────────────────────────────────────────────

// Every invoice sitting in the approval workflow, with the server's verdict on
// whether *this* user may act on it (mirrors approve_invoice()'s own gate, so
// the UI never offers a button the RPC would refuse).
export function useApprovalQueue() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["approval_queue", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("invoice_approval_queue" as any);
      if (error) throw error;
      return (data ?? []) as unknown as ApprovalQueueRow[];
    },
  });
}

// Tenant-wide approval event log (submissions, decisions and comments).
export function useApprovalLog(limit = 300) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["approval_log", appUser?.tenant_id, limit],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_approval_history" as any)
        .select("id, action, note, amount_base, step_index, step_name, created_at, invoice_id, invoices(invoice_number), users:actor_id(first_name, last_name, email)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as ApprovalEvent[];
    },
  });
}

// The full trail for one invoice, oldest first — decisions and comments woven
// into a single thread.
export function useInvoiceApprovalTrail(invoiceId?: string) {
  return useQuery({
    queryKey: ["invoice_approval_history", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_approval_history" as any)
        .select("id, action, note, amount_base, step_index, step_name, created_at, invoice_id, users:actor_id(first_name, last_name, email)")
        .eq("invoice_id", invoiceId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ApprovalEvent[];
    },
  });
}

// The chain that applies to a given base amount, straight from the same
// function the triggers use — so previews can never drift from enforcement.
export function useApprovalPlan(baseAmount?: number) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["approval_plan", appUser?.tenant_id, baseAmount],
    enabled: !!appUser?.tenant_id && baseAmount != null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("invoice_approval_plan" as any, {
        p_tenant_id: appUser!.tenant_id,
        p_base: baseAmount,
      });
      if (error) throw error;
      return (data ?? []) as unknown as (ApprovalStep & { index: number })[];
    },
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

function useApprovalInvalidation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["approval_queue"] });
    qc.invalidateQueries({ queryKey: ["approval_log"] });
    qc.invalidateQueries({ queryKey: ["invoice_approval_history"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
}

// Record a decision on the currently open level of the chain.
export function useDecideInvoice() {
  const invalidate = useApprovalInvalidation();
  return useMutation({
    mutationFn: async ({
      id, decision, note,
    }: { id: string; decision: "approved" | "rejected" | "changes_requested"; note?: string }) => {
      const { data, error } = await supabase.rpc("approve_invoice" as any, {
        p_invoice_id: id,
        p_decision: decision,
        p_note: note ?? null,
      });
      if (error) throw error;
      return { data: data as any, decision };
    },
    onSuccess: ({ data, decision }) => {
      invalidate();
      if (decision === "rejected") {
        toast.success("Invoice rejected");
      } else if (decision === "changes_requested") {
        toast.success("Sent back to the raiser");
      } else if (data?.final) {
        toast.success("Invoice fully approved — it can now be posted");
      } else if (data?.step_complete) {
        toast.success(`${data.step_name} cleared — now with ${data.next_step}`);
      } else {
        toast.success(`Approval recorded — ${data?.collected} of ${data?.required} at ${data?.step_name}`);
      }
    },
    onError: (e: Error) => toast.error(e.message.replace(/^.*?:\s*/, "")),
  });
}

// Put a sent-back (or rejected) invoice through the chain again, from level 1.
export function useResubmitInvoice() {
  const invalidate = useApprovalInvalidation();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const { data, error } = await supabase.rpc("resubmit_invoice" as any, {
        p_invoice_id: id,
        p_note: note ?? null,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data) => {
      invalidate();
      toast.success(
        data?.status === "not_required"
          ? "No approval needed any more — ready to post"
          : `Resubmitted — now with ${data?.step_name}`,
      );
    },
    onError: (e: Error) => toast.error(e.message.replace(/^.*?:\s*/, "")),
  });
}

// A comment on the approval — visible to the raiser and the open level's approvers.
export function useAddApprovalComment() {
  const invalidate = useApprovalInvalidation();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await supabase.rpc("add_invoice_approval_comment" as any, {
        p_invoice_id: id,
        p_note: note,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message.replace(/^.*?:\s*/, "")),
  });
}
