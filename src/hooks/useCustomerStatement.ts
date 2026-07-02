import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StatementRow {
  date: string;
  kind: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface CustomerStatement {
  opening_balance: number;
  closing_balance: number;
  rows: StatementRow[];
  aging: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
}

export function useCustomerStatement(customerId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["customer_statement", customerId, from, to],
    enabled: !!customerId && !!from && !!to,
    queryFn: async (): Promise<CustomerStatement> => {
      const { data, error } = await supabase.rpc("get_customer_statement" as any, {
        p_customer_id: customerId, p_from: from, p_to: to,
      });
      if (error) throw error;
      return data as unknown as CustomerStatement;
    },
  });
}
