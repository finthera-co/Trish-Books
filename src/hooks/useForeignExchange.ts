import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useExchangeRates() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["exchange_rates", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("exchange_rates")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("rate_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useUpsertExchangeRate() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { currency: string; rate_date: string; rate_to_base: number }) => {
      const { error } = await (supabase as any)
        .from("exchange_rates")
        .upsert(
          { tenant_id: appUser!.tenant_id, currency: input.currency.toUpperCase(), rate_date: input.rate_date, rate_to_base: input.rate_to_base },
          { onConflict: "tenant_id,currency,rate_date" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exchange_rates"] });
      toast.success("Exchange rate saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useFxRevaluations() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["ar_fx_revaluations", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ar_fx_revaluations")
        .select("*, invoices(invoice_number)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("period_end", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useRunFxRevaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (periodEnd: string) => {
      const { data, error } = await supabase.rpc("revalue_ar_fx" as any, { p_period_end: periodEnd });
      if (error) throw error;
      return data as { ok: boolean; invoices: number; net_fx: number; message?: string };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["ar_fx_revaluations"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(res?.message || `Revaluation posted (${res?.invoices ?? 0} invoices, net ${res?.net_fx ?? 0})`);
    },
    onError: (e: Error) => toast.error(e.message.replace(/^.*?:\s*/, "")),
  });
}
