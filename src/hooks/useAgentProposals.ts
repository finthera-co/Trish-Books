import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { EdgeFunctionError, invokeEdgeFunction } from "@/lib/edgeFunction";
import { describeError } from "@/lib/errorMessage";
import type { AgentBillPrefill } from "@/pages/EnterBill";

// The Bookkeeping Agent's review queue. The agent only ever inserts pending
// rows into agent_proposals; approving one here runs it through the path the
// app already uses for that action, on the approver's own session:
//
//   clear_suspense → clear_suspense_lines RPC   (same as Suspense Clearing)
//   journal_entry  → validate-journal-entry     (same as Journal Entries)
//   supplier_bill  → the Enter Bill form, pre-filled; saving it completes the
//                    proposal, and the bill is still only a draft
//
// The status moves through claim/complete/fail RPCs (see
// 20261104100000_bookkeeping_agent_proposals.sql) so two approvers, or a double
// click, cannot apply the same proposal twice.

export type ProposalKind = "journal_entry" | "supplier_bill" | "clear_suspense";
export type ProposalStatus = "pending" | "applying" | "applied" | "rejected" | "failed";

export interface AgentProposal {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  title: string;
  rationale: string;
  payload: any;
  preview: any;
  result: any;
  error: string | null;
  claimed_at: string | null;
  decided_at: string | null;
  created_at: string;
}

export const OPEN_STATUSES: ProposalStatus[] = ["pending", "applying", "failed"];

// Not in the generated types until `supabase gen types` is re-run.
const proposals = () => (supabase as any).from("agent_proposals");
const rpc = (fn: string, args: Record<string, unknown>) => (supabase as any).rpc(fn, args);

export function useAgentProposals(view: "open" | "history") {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["agent_proposals", appUser?.tenant_id, view],
    enabled: Boolean(appUser?.tenant_id),
    queryFn: async () => {
      let q = proposals()
        .select("id, kind, status, title, rationale, payload, preview, result, error, claimed_at, decided_at, created_at")
        .order("created_at", { ascending: view === "open" })
        .limit(200);
      q = view === "open"
        ? q.in("status", OPEN_STATUSES)
        : q.in("status", ["applied", "rejected"]);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AgentProposal[];
    },
  });
}

/** validate-journal-entry answers a rejected entry with 422 { errors: [...] };
 *  the reviewer needs those reasons, not "returned 422". */
function applyErrorMessage(e: unknown): string {
  if (e instanceof EdgeFunctionError) {
    const errors = (e.payload as { errors?: { message: string }[] } | null)?.errors;
    if (errors?.length) return errors.map((x) => x.message).join("; ");
  }
  return describeError(e);
}

function toBillPrefill(p: AgentProposal): AgentBillPrefill {
  const b = p.payload;
  return {
    proposal_id: p.id,
    vendor_id: b.vendor_id,
    bill_date: b.bill_date,
    due_date: b.due_date ?? null,
    vendor_ref: b.vendor_ref ?? null,
    notes: b.memo ?? null,
    lines: (b.lines ?? []).map((l: any) => ({
      account_id: l.account_id,
      description: l.description ?? "",
      qty: String(l.qty ?? 1),
      unit_cost: String(l.unit_cost ?? 0),
      tax_sel: l.tax_group_id ? `g:${l.tax_group_id}` : l.tax_code_id ? `c:${l.tax_code_id}` : "",
      is_tax_inclusive: !!l.is_tax_inclusive,
    })),
  };
}

export function useApproveProposal() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async (p: AgentProposal): Promise<{ opened?: boolean }> => {
      if (p.kind === "supplier_bill") {
        // No claim: the proposal completes when the form is saved, and stays
        // pending if the reviewer backs out of it.
        navigate("/accounting/bills/new", { state: { agentBill: toBillPrefill(p) } });
        return { opened: true };
      }

      const { error: claimErr } = await rpc("claim_agent_proposal", { p_id: p.id });
      if (claimErr) throw new Error(claimErr.message);

      let result: unknown;
      try {
        if (p.kind === "clear_suspense") {
          const { data, error } = await rpc("clear_suspense_lines", {
            p_line_ids: p.payload.line_ids,
            p_target_account_id: p.payload.target_account_id,
            p_note: `Bookkeeping agent: ${p.title}`,
            p_teach_variant: p.payload.teach_variant ?? null,
            p_memo: p.payload.memo ?? null,
          });
          if (error) throw new Error(error.message);
          result = data;
        } else {
          result = await invokeEdgeFunction("validate-journal-entry", p.payload);
        }
      } catch (e) {
        const message = applyErrorMessage(e);
        // Best effort: if this fails too, the claim expires after 10 minutes
        // and the proposal can be retried.
        await rpc("fail_agent_proposal", { p_id: p.id, p_error: message });
        throw new Error(message);
      }

      const { error: doneErr } = await rpc("complete_agent_proposal", { p_id: p.id, p_result: result });
      if (doneErr) {
        // The action went through; only the bookkeeping on the proposal did not.
        throw new Error(`Applied, but the proposal could not be marked done: ${doneErr.message}`);
      }
      return {};
    },
    onSuccess: (data, p) => {
      if (data.opened) return;
      toast.success(p.kind === "journal_entry" ? "Journal entry posted" : "Suspense lines cleared");
      // The same set the Suspense Clearing and Journal Entries pages invalidate.
      for (const key of [
        "suspense_lines",
        "suspense_cleared_stats",
        "journal_entries",
        "period_account_movements",
        "bank_category_account_map",
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ["agent_proposals"] }),
  });
}

export function useRejectProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; reason?: string }) => {
      const { error } = await rpc("reject_agent_proposal", {
        p_id: args.id,
        p_reason: args.reason?.trim() || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => toast.success("Proposal rejected"),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ["agent_proposals"] }),
  });
}
