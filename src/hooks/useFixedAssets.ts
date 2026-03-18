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

      // Fetch depreciation expense & accumulated depreciation accounts
      const { data: depExpAcct } = await supabase
        .from("accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("account_type", "Expense")
        .ilike("account_name", "%depreciation%")
        .limit(1)
        .maybeSingle();

      const { data: accDepAcct } = await supabase
        .from("accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .ilike("account_name", "%accumulated depreciation%")
        .limit(1)
        .maybeSingle();

      if (!depExpAcct || !accDepAcct) {
        throw new Error("Please create a 'Depreciation Expense' account and an 'Accumulated Depreciation' account in your Chart of Accounts first.");
      }

      let processed = 0;
      let skipped = 0;

      for (const raw of (assets || [])) {
        const startDate = (raw as any).start_date || raw.acquisition_date;
        if (!startDate) { skipped++; continue; }
        if (!isPeriodEligible(startDate, period)) { skipped++; continue; }

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

        // Journal lines
        await supabase.from("journal_lines").insert([
          { journal_entry_id: je.id, account_id: depExpAcct.id, debit: depreciation, credit: 0 },
          { journal_entry_id: je.id, account_id: accDepAcct.id, debit: 0, credit: depreciation },
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

      // Fetch accounts
      const { data: cashAcct } = await supabase
        .from("accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("account_type", "Asset")
        .ilike("account_name", "%cash%")
        .limit(1)
        .maybeSingle();

      const { data: assetAcct } = await supabase
        .from("accounts")
        .select("id")
        .eq("id", asset.asset_account_id!)
        .maybeSingle();

      if (!cashAcct || !assetAcct) {
        throw new Error("Cash or asset account not found. Please configure accounts first.");
      }

      // Create disposal journal entry
      const lines: { account_id: string; debit: number; credit: number }[] = [];

      // Dr Cash for sale_value
      if (saleValue > 0) {
        lines.push({ account_id: cashAcct.id, debit: saleValue, credit: 0 });
      }

      // Cr Asset for NBV
      lines.push({ account_id: assetAcct.id, debit: 0, credit: nbv });

      // Gain or Loss
      if (gainLoss > 0) {
        // Gain - credit
        lines.push({ account_id: assetAcct.id, debit: 0, credit: gainLoss });
      } else if (gainLoss < 0) {
        // Loss - debit
        lines.push({ account_id: assetAcct.id, debit: Math.abs(gainLoss), credit: 0 });
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
      toast.success("Asset disposed successfully");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
