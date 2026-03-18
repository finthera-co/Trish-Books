import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { runDepreciationForAsset, isPeriodEligible, type Asset } from "@/lib/depreciation";

export function useFixedAssets() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["fixed_assets", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_assets")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useFixedAsset(id: string | undefined) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["fixed_asset", id],
    enabled: !!id && !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_assets")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useAssetDepreciation(assetId: string | undefined) {
  return useQuery({
    queryKey: ["asset_depreciation", assetId],
    enabled: !!assetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_depreciation")
        .select("*")
        .eq("asset_id", assetId!)
        .order("period", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useAssetJournalEntries(assetId: string | undefined) {
  return useQuery({
    queryKey: ["asset_journal_entries", assetId],
    enabled: !!assetId,
    queryFn: async () => {
      // Get journal entry IDs from depreciation records
      const { data: depRecs } = await supabase
        .from("asset_depreciation")
        .select("journal_entry_id, period")
        .eq("asset_id", assetId!)
        .not("journal_entry_id", "is", null)
        .order("period", { ascending: true });

      // Get journal entry IDs from disposals
      const { data: dispRecs } = await supabase
        .from("asset_disposals")
        .select("journal_entry_id, disposal_date")
        .eq("asset_id", assetId!)
        .not("journal_entry_id", "is", null);

      const jeIds = [
        ...(depRecs?.map(r => r.journal_entry_id).filter(Boolean) ?? []),
        ...(dispRecs?.map(r => r.journal_entry_id).filter(Boolean) ?? []),
      ];

      if (jeIds.length === 0) return [];

      const { data: entries, error } = await supabase
        .from("journal_entries")
        .select("id, entry_date, description, status, journal_lines(id, account_id, debit, credit, accounts:account_id(account_code, account_name))")
        .in("id", jeIds)
        .order("entry_date", { ascending: true });
      if (error) throw error;
      return entries ?? [];
    },
  });
}

export function useCreateAsset() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (asset: {
      asset_name: string;
      cost: number;
      salvage_value: number;
      useful_life_months: number;
      depreciation_method?: string;
      acquisition_date?: string;
      start_date?: string;
      description?: string;
      asset_account_id?: string;
      depreciation_account_id?: string;
      depr_expense_account_id?: string;
    }) => {
      const { data, error } = await supabase
        .from("fixed_assets")
        .insert({
          ...asset,
          tenant_id: appUser!.tenant_id,
          status: "active",
          accumulated_depreciation: 0,
          net_book_value: asset.cost,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fixed_assets"] });
      toast.success("Asset created successfully");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      const { error } = await supabase
        .from("fixed_assets")
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fixed_assets"] });
      qc.invalidateQueries({ queryKey: ["fixed_asset"] });
      toast.success("Asset updated");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useRunDepreciation() {
  const qc = useQueryClient();
  const { appUser } = useAuth();

  return useMutation({
    mutationFn: async (period: string) => {
      const tenantId = appUser!.tenant_id;

      // Fetch active assets
      const { data: assets, error: aErr } = await supabase
        .from("fixed_assets")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "active");
      if (aErr) throw aErr;

      // Fallback: fetch default accounts by name if asset-level not set
      const { data: fallbackExpAcct } = await supabase
        .from("accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("account_type", "Expense")
        .ilike("account_name", "%depreciation%")
        .limit(1)
        .maybeSingle();

      const { data: fallbackAccDepAcct } = await supabase
        .from("accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .ilike("account_name", "%accumulated depreciation%")
        .limit(1)
        .maybeSingle();

      let processed = 0;
      let skipped = 0;

      for (const raw of (assets || [])) {
        const startDate = (raw as any).start_date || raw.acquisition_date;
        if (!startDate) { skipped++; continue; }
        if (!isPeriodEligible(startDate, period)) { skipped++; continue; }

        // Resolve per-asset accounts, falling back to tenant defaults
        const expenseAccountId = (raw as any).depr_expense_account_id || fallbackExpAcct?.id;
        const accumAccountId = raw.depreciation_account_id || fallbackAccDepAcct?.id;

        if (!expenseAccountId || !accumAccountId) {
          skipped++;
          continue;
        }

        // Check duplicate
        const { data: existing } = await supabase
          .from("asset_depreciation")
          .select("id")
          .eq("asset_id", raw.id)
          .eq("period", period)
          .maybeSingle();
        if (existing) { skipped++; continue; }

        // Get last accumulated
        const { data: lastRec } = await supabase
          .from("asset_depreciation")
          .select("accumulated_depreciation")
          .eq("asset_id", raw.id)
          .order("period", { ascending: false })
          .limit(1)
          .maybeSingle();

        const prevAccum = lastRec?.accumulated_depreciation ?? raw.accumulated_depreciation ?? 0;

        const asset: Asset = {
          id: raw.id,
          cost: raw.cost,
          salvage_value: (raw as any).salvage_value ?? 0,
          useful_life_months: (raw as any).useful_life_months ?? 12,
          start_date: startDate,
          status: raw.status as "active" | "disposed",
        };

        const { depreciation, newAccumulated, newNBV } = runDepreciationForAsset(asset, prevAccum);
        if (depreciation <= 0) { skipped++; continue; }

        // Create journal entry
        const { data: je, error: jeErr } = await supabase
          .from("journal_entries")
          .insert({
            tenant_id: tenantId,
            entry_date: `${period}-01`,
            description: `Depreciation - ${raw.asset_name} (${period})`,
            status: "posted",
            is_system_generated: true,
            entry_type: "depreciation",
          })
          .select("id")
          .single();
        if (jeErr) throw jeErr;

        // Journal lines: Dr Depreciation Expense, Cr Accumulated Depreciation
        await supabase.from("journal_lines").insert([
          { journal_entry_id: je.id, account_id: expenseAccountId, debit: depreciation, credit: 0 },
          { journal_entry_id: je.id, account_id: accumAccountId, debit: 0, credit: depreciation },
        ]);

        // Insert depreciation record
        await supabase.from("asset_depreciation").insert({
          asset_id: raw.id,
          tenant_id: tenantId,
          period,
          depreciation_amount: Math.round(depreciation * 100) / 100,
          accumulated_depreciation: Math.round(newAccumulated * 100) / 100,
          net_book_value: Math.round(newNBV * 100) / 100,
          journal_entry_id: je.id,
        } as any);

        // Update asset running totals
        await supabase
          .from("fixed_assets")
          .update({
            accumulated_depreciation: Math.round(newAccumulated * 100) / 100,
            net_book_value: Math.round(newNBV * 100) / 100,
          })
          .eq("id", raw.id);

        processed++;
      }

      return { processed, skipped };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["fixed_assets"] });
      qc.invalidateQueries({ queryKey: ["asset_depreciation"] });
      qc.invalidateQueries({ queryKey: ["asset_journal_entries"] });
      toast.success(`Depreciation run complete: ${result.processed} processed, ${result.skipped} skipped`);
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDisposeAsset() {
  const qc = useQueryClient();
  const { appUser } = useAuth();

  return useMutation({
    mutationFn: async ({ assetId, saleValue }: { assetId: string; saleValue: number }) => {
      const tenantId = appUser!.tenant_id;

      const { data: asset, error: aErr } = await supabase
        .from("fixed_assets")
        .select("*")
        .eq("id", assetId)
        .single();
      if (aErr) throw aErr;

      const nbv = asset.net_book_value ?? (asset.cost - (asset.accumulated_depreciation ?? 0));
      const gainLoss = saleValue - nbv;
      const accumDepr = asset.accumulated_depreciation ?? 0;

      // Resolve accounts
      const assetAccountId = asset.asset_account_id;
      const accumAccountId = asset.depreciation_account_id;

      if (!assetAccountId) {
        throw new Error("Asset account is not configured. Please edit the asset and link an Asset Account.");
      }

      // Fetch cash account
      const { data: cashAcct } = await supabase
        .from("accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("account_type", "Asset")
        .ilike("account_name", "%cash%")
        .limit(1)
        .maybeSingle();

      if (!cashAcct) {
        throw new Error("Cash account not found. Please create a Cash account in your Chart of Accounts.");
      }

      // Fetch gain/loss account
      const gainLossType = gainLoss >= 0 ? "Income" : "Expense";
      const gainLossPattern = gainLoss >= 0 ? "%gain%dispos%" : "%loss%dispos%";
      const { data: gainLossAcct } = await supabase
        .from("accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("account_type", gainLossType)
        .ilike("account_name", gainLossPattern)
        .limit(1)
        .maybeSingle();

      // Build balanced journal entry lines
      const lines: { account_id: string; debit: number; credit: number }[] = [];

      // Dr Cash for sale proceeds
      if (saleValue > 0) {
        lines.push({ account_id: cashAcct.id, debit: saleValue, credit: 0 });
      }

      // Dr Accumulated Depreciation (remove contra)
      if (accumAccountId && accumDepr > 0) {
        lines.push({ account_id: accumAccountId, debit: accumDepr, credit: 0 });
      }

      // Cr Asset Account (remove full cost)
      lines.push({ account_id: assetAccountId, debit: 0, credit: asset.cost });

      // Gain or Loss entry
      if (gainLoss > 0 && gainLossAcct) {
        lines.push({ account_id: gainLossAcct.id, debit: 0, credit: gainLoss });
      } else if (gainLoss < 0 && gainLossAcct) {
        lines.push({ account_id: gainLossAcct.id, debit: Math.abs(gainLoss), credit: 0 });
      } else if (gainLoss !== 0) {
        // Fallback: post gain/loss to asset account if no dedicated account exists
        if (gainLoss > 0) {
          lines.push({ account_id: assetAccountId, debit: 0, credit: gainLoss });
        } else {
          lines.push({ account_id: assetAccountId, debit: Math.abs(gainLoss), credit: 0 });
        }
      }

      const { data: je, error: jeErr } = await supabase
        .from("journal_entries")
        .insert({
          tenant_id: tenantId,
          entry_date: new Date().toISOString().split("T")[0],
          description: `Asset Disposal - ${asset.asset_name}`,
          status: "posted",
          is_system_generated: true,
          entry_type: "disposal",
        })
        .select("id")
        .single();
      if (jeErr) throw jeErr;

      await supabase.from("journal_lines").insert(
        lines.map(l => ({ ...l, journal_entry_id: je.id }))
      );

      // Record disposal
      await supabase.from("asset_disposals").insert({
        asset_id: assetId,
        tenant_id: tenantId,
        disposal_date: new Date().toISOString().split("T")[0],
        sale_value: saleValue,
        gain_loss: gainLoss,
        journal_entry_id: je.id,
      } as any);

      // Mark asset as disposed
      await supabase
        .from("fixed_assets")
        .update({ status: "disposed" })
        .eq("id", assetId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fixed_assets"] });
      qc.invalidateQueries({ queryKey: ["asset_journal_entries"] });
      toast.success("Asset disposed successfully");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
