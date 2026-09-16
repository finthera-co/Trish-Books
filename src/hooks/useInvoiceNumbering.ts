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
 * The next auto-generated invoice number per branch. The counter is continuous
 * per branch — it never restarts — so `period` no longer picks a counter, it
 * only says which YYMMM stamp an invoice dated then would carry.
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
 * Remove a branch's number series outright — counter and register rows. A
 * series is the whole branch now that numbering runs on across months.
 * The RPC refuses when any invoice uses a number from it, so a series that
 * actually issued something can't be erased.
 */
export function useDeleteInvoiceNumberSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (branchCode: string) => {
      const { data, error } = await supabase.rpc("delete_invoice_number_series" as any, {
        p_branch_code: branchCode,
      });
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSuccess: (_rows, branchCode) => {
      qc.invalidateQueries({ queryKey: ["invoice_next_numbers"] });
      qc.invalidateQueries({ queryKey: ["invoice_serial_register"] });
      toast.success(`Removed the ${branchCode} number series`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Remove one unissued number from the register. Deleting the highest numbers
 * pulls the branch counter back with them, so those numbers get handed out
 * again — which is how a botched run of test drafts is undone.
 */
export function useDeleteInvoiceNumberRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (serial: string) => {
      const { data, error } = await supabase.rpc("delete_invoice_number_row" as any, { p_serial: serial });
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSuccess: (nextSeq, serial) => {
      qc.invalidateQueries({ queryKey: ["invoice_next_numbers"] });
      qc.invalidateQueries({ queryKey: ["invoice_serial_register"] });
      toast.success(`Removed ${serial} — next number is now ${nextSeq}`);
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
