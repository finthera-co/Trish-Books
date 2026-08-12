import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { toast } from "sonner";

type EngineAction = "snapshot" | "match" | "validate" | "finalize";

export function useReconcileEngine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ reconciliationId, action }: { reconciliationId: string; action: EngineAction }) => {
      return await invokeEdgeFunction("reconcile-engine", {
        reconciliation_id: reconciliationId,
        action,
      });
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["bank_feed_transactions", vars.reconciliationId] });
      qc.invalidateQueries({ queryKey: ["reconciliation_transactions", vars.reconciliationId] });
      qc.invalidateQueries({ queryKey: ["bank_reconciliations"] });
      qc.invalidateQueries({ queryKey: ["reconciliation_snapshots", vars.reconciliationId] });
      qc.invalidateQueries({ queryKey: ["reconciliation_invariant_log", vars.reconciliationId] });

      if (vars.action === "snapshot") toast.success("Snapshot captured");
      if (vars.action === "match") {
        const ra = data.rule_auto_created || 0;
        const rl = data.rules_loaded || 0;
        const ap = data.ap_matched || 0;
        toast.success(
          `Engine: ${data.auto || 0} auto · ${data.suggested || 0} suggested · ${data.composite || 0} composite` +
          (ap ? ` · ${ap} AP` : "") +
          (ra ? ` · ${ra} rule-posted` : "") +
          (rl ? ` (${rl} rules active)` : "")
        );
      }
      if (vars.action === "validate") toast[data.ok ? "success" : "error"](data.ok ? "All invariants passed" : "Invariant check failed");
      if (vars.action === "finalize") toast.success("Reconciliation finalized & locked");
    },
    onError: (e: Error) => toast.error(`Engine: ${e.message}`),
  });
}

export function useReconciliationSnapshots(reconciliationId?: string) {
  return useQuery({
    queryKey: ["reconciliation_snapshots", reconciliationId],
    queryFn: async () => {
      if (!reconciliationId) return [];
      const { data, error } = await supabase
        .from("reconciliation_snapshots")
        .select("*")
        .eq("reconciliation_id", reconciliationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!reconciliationId,
  });
}

export function useInvariantLog(reconciliationId?: string) {
  return useQuery({
    queryKey: ["reconciliation_invariant_log", reconciliationId],
    queryFn: async () => {
      if (!reconciliationId) return [];
      const { data, error } = await supabase
        .from("reconciliation_invariant_log")
        .select("*")
        .eq("reconciliation_id", reconciliationId)
        .order("checked_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!reconciliationId,
  });
}
