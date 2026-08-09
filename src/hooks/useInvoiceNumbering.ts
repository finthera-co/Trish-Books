import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface NextNumberRow {
  branch_code: string;
  yy: number;
  mmm: string;
  next_seq: number;
  next_serial: string;
}

/**
 * The next auto-generated invoice number per branch, for the month `period`
 * falls in. Numbering restarts each month under the IRD YYMMM_QQQQ_XXXXX
 * format, so a counter only ever means something within one branch + month.
 */
export function useInvoiceNextNumbers(period: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["invoice_next_numbers", appUser?.tenant_id, period],
    enabled: !!appUser?.tenant_id && !!period,
    queryFn: async (): Promise<NextNumberRow[]> => {
      const { data, error } = await supabase.rpc("invoice_next_numbers" as any, { p_period: period });
      if (error) throw error;
      return (data || []) as NextNumberRow[];
    },
  });
}

/**
 * Remove a branch's number series outright — counter and register rows.
 * The RPC refuses when any invoice uses a number from it, so a series that
 * actually issued something can't be erased.
 */
export function useDeleteInvoiceNumberSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { branchCode: string; period: string }) => {
      const { data, error } = await supabase.rpc("delete_invoice_number_series" as any, {
        p_branch_code: input.branchCode,
        p_period: input.period,
      });
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSuccess: (_rows, input) => {
      qc.invalidateQueries({ queryKey: ["invoice_next_numbers"] });
      qc.invalidateQueries({ queryKey: ["invoice_serial_register"] });
      toast.success(`Removed the ${input.branchCode} number series`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSetInvoiceNextNumber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { branchCode: string; period: string; nextSeq: number }) => {
      const { data, error } = await supabase.rpc("set_invoice_next_number" as any, {
        p_branch_code: input.branchCode,
        p_period: input.period,
        p_next_seq: input.nextSeq,
      });
      // The RPC refuses to wind the counter back and says which number is the
      // lowest it will accept — surface that verbatim, it's the useful part.
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: ["invoice_next_numbers"] });
      qc.invalidateQueries({ queryKey: ["invoice_serial_register"] });
      toast.success(`Next invoice number set to ${next}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
