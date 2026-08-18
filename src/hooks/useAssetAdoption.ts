import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/** One posted PP&E debit and the register record the engine would build from it. */
export interface CoaAssetCandidate {
  account_id: string;
  account_code: string;
  account_name: string;
  class_key: string;
  useful_life_months: number;
  depreciation_method: string;
  is_depreciable: boolean;
  journal_line_id: string;
  journal_entry_id: string;
  entry_date: string;
  proposed_name: string;
  cost: number;
  months_to_charge: number;
  est_depreciation: number;
  est_net_book_value: number;
  already_adopted: boolean;
}

/** Candidates rolled up the way an accountant reads them — by asset class. */
export interface CoaAssetClassSummary {
  account_id: string;
  account_code: string;
  account_name: string;
  class_key: string;
  useful_life_months: number;
  depreciation_method: string;
  is_depreciable: boolean;
  asset_count: number;
  adopted_count: number;
  total_cost: number;
  est_depreciation: number;
  est_net_book_value: number;
  earliest_date: string;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useCoaAssetAnalysis(throughPeriod: string | null) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["coa_asset_analysis", appUser?.tenant_id, throughPeriod ?? null],
    enabled: !!appUser?.tenant_id,
    queryFn: async (): Promise<CoaAssetCandidate[]> => {
      const { data, error } = await supabase.rpc("analyze_coa_assets", {
        p_through_period: throughPeriod ?? undefined,
      });
      if (error) throw error;
      // Numerics arrive as strings over PostgREST once they exceed the JS
      // safe-integer range, so every money column is normalised here.
      return (data ?? []).map(r => ({
        ...r,
        cost: num(r.cost),
        useful_life_months: num(r.useful_life_months),
        months_to_charge: num(r.months_to_charge),
        est_depreciation: num(r.est_depreciation),
        est_net_book_value: num(r.est_net_book_value),
      }));
    },
    staleTime: 30_000,
  });
}

export function summariseByClass(rows: CoaAssetCandidate[]): CoaAssetClassSummary[] {
  const byAccount = new Map<string, CoaAssetClassSummary>();
  rows.forEach(r => {
    let s = byAccount.get(r.account_id);
    if (!s) {
      s = {
        account_id: r.account_id,
        account_code: r.account_code,
        account_name: r.account_name,
        class_key: r.class_key,
        useful_life_months: r.useful_life_months,
        depreciation_method: r.depreciation_method,
        is_depreciable: r.is_depreciable,
        asset_count: 0,
        adopted_count: 0,
        total_cost: 0,
        est_depreciation: 0,
        est_net_book_value: 0,
        earliest_date: r.entry_date,
      };
      byAccount.set(r.account_id, s);
    }
    s.asset_count += 1;
    if (r.already_adopted) s.adopted_count += 1;
    s.total_cost += r.cost;
    s.est_depreciation += r.est_depreciation;
    s.est_net_book_value += r.est_net_book_value;
    if (r.entry_date < s.earliest_date) s.earliest_date = r.entry_date;
  });
  return [...byAccount.values()].sort((a, b) => a.account_code.localeCompare(b.account_code));
}

export interface AdoptionResult {
  success: boolean;
  through_period: string;
  accounts_created: number;
  categories_created: number;
  assets_created: number;
  schedule_rows: number;
  periods_posted: number;
  depreciation_posted: number;
  periods: Array<{
    period: string;
    assets?: number;
    amount?: number;
    journal_entry_id?: string;
    skipped_reason?: string;
    unresolved_accounts?: number;
  }>;
}

const ASSET_QUERY_KEYS = [
  "fixed_assets", "fixed_asset", "asset_categories", "asset_depreciation",
  "asset_subledger", "asset_journal_entries", "asset_depreciation_period",
  "coa_asset_analysis", "fixed_asset_schedule",
  "accounts", "chart_of_accounts", "trial_balance", "balance_sheet",
  "journal_entries", "fs_statement", "fs_statement_accounts",
];

export function useAdoptCoaAssets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ throughPeriod, postDepreciation }: {
      throughPeriod: string | null;
      postDepreciation: boolean;
    }): Promise<AdoptionResult> => {
      const { data, error } = await supabase.rpc("adopt_coa_assets", {
        p_through_period: throughPeriod ?? undefined,
        p_post_depreciation: postDepreciation,
      });
      if (error) throw error;
      return data as unknown as AdoptionResult;
    },
    onSuccess: (r) => {
      ASSET_QUERY_KEYS.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(
        r.assets_created > 0
          ? `${r.assets_created} assets added to the register`
          : "Register already up to date"
      );
    },
    onError: (e: unknown) => toast.error(message(e)),
  });
}
