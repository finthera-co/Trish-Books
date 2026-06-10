import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/** Fetch all fiscal periods for the current tenant */
export function useFiscalPeriods() {
  return useQuery({
    queryKey: ["fiscal_periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fiscal_periods")
        .select("*, users!fiscal_periods_closed_by_fkey(first_name, last_name)")
        .order("period_start", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
}

/** Get the currently-open fiscal period */
export function useCurrentFiscalPeriod() {
  const { data: periods } = useFiscalPeriods();
  const open = periods?.find((p: any) => p.status === "open");
  return open || periods?.[periods.length - 1] || null;
}

/** Fetch opening balances for a specific fiscal period */
export function usePeriodOpeningBalances(fiscalPeriodId: string | null) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["period_opening_balances", appUser?.tenant_id, fiscalPeriodId],
    queryFn: async () => {
      if (!fiscalPeriodId || !appUser?.tenant_id) return [];
      const { data, error } = await supabase
        .from("opening_balances")
        .select("id, account_id, debit, credit, balance, fiscal_period_id")
        .eq("tenant_id", appUser.tenant_id)
        .eq("fiscal_period_id", fiscalPeriodId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!fiscalPeriodId && !!appUser?.tenant_id,
  });
}

/** Save opening balances for a specific fiscal period */
export function useSavePeriodOpeningBalances() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      fiscalPeriodId,
      balances,
    }: {
      fiscalPeriodId: string;
      balances: { account_id: string; debit: number; credit: number }[];
    }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");

      // Upsert each balance
      const rows = balances
        .filter((b) => b.debit > 0 || b.credit > 0)
        .map((b) => ({
          tenant_id: appUser.tenant_id,
          account_id: b.account_id,
          fiscal_period_id: fiscalPeriodId,
          debit: b.debit,
          credit: b.credit,
          balance: b.debit - b.credit, // maintain legacy column
        }));

      if (rows.length === 0) return;

      const { error } = await supabase
        .from("opening_balances")
        .upsert(rows, { onConflict: "account_id,fiscal_period_id" });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["period_opening_balances"] });
      queryClient.invalidateQueries({ queryKey: ["opening_balances"] });
      toast.success("Opening balances saved for this period");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Close a fiscal period:
 * 1. Calculate closing balances (opening + transactions)
 * 2. Close temp accounts (Revenue/Expense/COGS) to Retained Earnings
 * 3. Insert carry-forward opening balances for the next period
 * 4. Lock the period
 */
export function useCloseFiscalPeriod() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (periodId: string) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");

      // 1. Get period details
      const { data: period } = await supabase
        .from("fiscal_periods")
        .select("*")
        .eq("id", periodId)
        .single();
      if (!period) throw new Error("Period not found");
      if (period.status === "closed") throw new Error("Period is already closed");

      // 2. Get all accounts
      const { data: accounts } = await supabase
        .from("accounts")
        .select("id, account_type, account_name")
        .eq("tenant_id", appUser.tenant_id);
      if (!accounts) throw new Error("Failed to fetch accounts");

      // 3. Get opening balances for this period
      const { data: periodOB } = await supabase
        .from("opening_balances")
        .select("account_id, debit, credit")
        .eq("tenant_id", appUser.tenant_id)
        .eq("fiscal_period_id", periodId);

      const obMap = new Map(
        (periodOB || []).map((ob) => [
          ob.account_id,
          { debit: Number(ob.debit), credit: Number(ob.credit) },
        ])
      );

      // 4. Get all posted journal lines in this period's date range
      const { data: journalLines } = await supabase
        .from("journal_lines")
        .select(
          "account_id, debit, credit, journal_entries!inner(entry_date, status, tenant_id, voided_at)"
        )
        .filter("journal_entries.tenant_id", "eq", appUser.tenant_id);

      if (!journalLines) throw new Error("Failed to fetch journal lines");

      // 5. Calculate closing balances
      const DEBIT_NORMAL_TYPES = ["Asset", "Expense", "COGS"];
      const BALANCE_SHEET_TYPES = ["Asset", "Liability", "Equity"];
      const TEMP_TYPES = ["Revenue", "Income", "Expense", "COGS"];

      const closingBalances = new Map<string, { debit: number; credit: number }>();

      accounts.forEach((a) => {
        const ob = obMap.get(a.id) || { debit: 0, credit: 0 };
        let netDebit = ob.debit;
        let netCredit = ob.credit;

        // Sum transactions in period
        journalLines.forEach((line: any) => {
          const entry = line.journal_entries;
          if (!entry || entry.status !== "posted" || entry.voided_at) return;
          if (entry.entry_date < period.period_start || entry.entry_date > period.period_end) return;
          if (line.account_id !== a.id) return;

          netDebit += Number(line.debit);
          netCredit += Number(line.credit);
        });

        closingBalances.set(a.id, { debit: netDebit, credit: netCredit });
      });

      // 6. Find next period
      const { data: nextPeriod } = await supabase
        .from("fiscal_periods")
        .select("id")
        .eq("tenant_id", appUser.tenant_id)
        .gt("period_start", period.period_end)
        .order("period_start")
        .limit(1)
        .maybeSingle();

      if (nextPeriod) {
        // 7. Calculate net income from temp accounts
        let netIncomeDebit = 0;
        let netIncomeCredit = 0;

        accounts.forEach((a) => {
          if (!TEMP_TYPES.includes(a.account_type)) return;
          const bal = closingBalances.get(a.id);
          if (!bal) return;
          // Revenue is credit-normal, Expense/COGS debit-normal
          if (a.account_type === "Revenue" || a.account_type === "Income") {
            // Net revenue = credit - debit (positive = income)
            const net = bal.credit - bal.debit;
            if (net > 0) netIncomeCredit += net;
            else netIncomeDebit += Math.abs(net);
          } else {
            // Net expense = debit - credit (positive = expense)
            const net = bal.debit - bal.credit;
            if (net > 0) netIncomeDebit += net;
            else netIncomeCredit += Math.abs(net);
          }
        });

        // 8. Find Retained Earnings account — prefer account_settings mapping, fallback to name search
        let reAccountId: string | null = null;
        const { data: acctSettings } = await supabase
          .from("account_settings")
          .select("retained_earnings_account_id")
          .eq("tenant_id", appUser.tenant_id)
          .maybeSingle();
        if (acctSettings?.retained_earnings_account_id) {
          reAccountId = acctSettings.retained_earnings_account_id;
        } else {
          const { data: reAccount } = await supabase
            .from("accounts")
            .select("id")
            .eq("tenant_id", appUser.tenant_id)
            .eq("account_type", "Equity")
            .ilike("account_name", "%retained earnings%")
            .limit(1)
            .maybeSingle();
          reAccountId = reAccount?.id ?? null;
        }

        // 9. Build next period opening balances (balance sheet accounts only)
        const nextOBRows: {
          tenant_id: string;
          account_id: string;
          fiscal_period_id: string;
          debit: number;
          credit: number;
          balance: number;
        }[] = [];

        accounts.forEach((a) => {
          if (!BALANCE_SHEET_TYPES.includes(a.account_type)) return;
          const bal = closingBalances.get(a.id);
          if (!bal) return;

          let debit = bal.debit;
          let credit = bal.credit;

          // Add net income to Retained Earnings
          if (reAccountId && a.id === reAccountId) {
            // Net income: credit Retained Earnings for profit, debit for loss
            // Revenue net (credit-side) minus Expense net (debit-side)
            credit += netIncomeCredit;
            debit += netIncomeDebit;
          }

          // Only carry forward if there's a non-zero balance
          const net = debit - credit;
          if (Math.abs(net) > 0.005) {
            nextOBRows.push({
              tenant_id: appUser.tenant_id,
              account_id: a.id,
              fiscal_period_id: nextPeriod.id,
              debit: net > 0 ? net : 0,
              credit: net < 0 ? Math.abs(net) : 0,
              balance: net,
            });
          }
        });

        if (nextOBRows.length > 0) {
          // Delete existing OBs for next period first (clean slate)
          await supabase
            .from("opening_balances")
            .delete()
            .eq("tenant_id", appUser.tenant_id)
            .eq("fiscal_period_id", nextPeriod.id);

          const { error: obErr } = await supabase
            .from("opening_balances")
            .insert(nextOBRows);
          if (obErr) throw obErr;
        }

        if (!reAccountId && Math.abs(netIncomeCredit - netIncomeDebit) > 0.005) {
          console.warn(
            "No Retained Earnings account found. Net income was not carried forward."
          );
        }
      }

      // 10. Close the period
      const { error } = await supabase
        .from("fiscal_periods")
        .update({
          status: "closed",
          closed_at: new Date().toISOString(),
          closed_by: appUser.id,
        })
        .eq("id", periodId);
      if (error) throw error;

      // Audit
      await supabase.from("audit_logs").insert({
        action: "Fiscal Period Closed",
        table_name: "fiscal_periods",
        record_id: periodId,
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
        details: {
          period_name: period.name,
          next_period_id: nextPeriod?.id || null,
          accounts_carried: nextPeriod ? "yes" : "no_next_period",
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiscal_periods"] });
      queryClient.invalidateQueries({ queryKey: ["period_opening_balances"] });
      queryClient.invalidateQueries({ queryKey: ["opening_balances"] });
      toast.success("Period closed and balances carried forward");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Reopen a closed fiscal period */
export function useReopenFiscalPeriod() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (periodId: string) => {
      const { error } = await supabase
        .from("fiscal_periods")
        .update({ status: "open", closed_at: null, closed_by: null })
        .eq("id", periodId);
      if (error) throw error;

      await supabase.from("audit_logs").insert({
        action: "Fiscal Period Reopened",
        table_name: "fiscal_periods",
        record_id: periodId,
        user_id: appUser?.id,
        tenant_id: appUser?.tenant_id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiscal_periods"] });
      toast.success("Period reopened");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
