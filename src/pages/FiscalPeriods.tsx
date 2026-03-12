import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Lock, Unlock, Calendar } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function FiscalPeriods() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  const { data: periods, isLoading } = useQuery({
    queryKey: ["fiscal_periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fiscal_periods")
        .select("*, users!fiscal_periods_closed_by_fkey(first_name, last_name)")
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createPeriod = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fiscal_periods").insert({
        tenant_id: appUser?.tenant_id,
        name,
        period_start: periodStart,
        period_end: periodEnd,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiscal_periods"] });
      toast.success("Fiscal period created");
      setOpen(false);
      setName("");
      setPeriodStart("");
      setPeriodEnd("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closePeriod = useMutation({
    mutationFn: async (periodId: string) => {
      // 1. Get the period details
      const { data: period } = await supabase
        .from("fiscal_periods")
        .select("*")
        .eq("id", periodId)
        .single();
      if (!period) throw new Error("Period not found");

      // 2. Calculate closing balances for all accounts from journal lines within the period
      const { data: accounts } = await supabase
        .from("accounts")
        .select("id, account_type")
        .eq("tenant_id", appUser?.tenant_id!);

      const { data: journalLines } = await supabase
        .from("journal_lines")
        .select("account_id, debit, credit, journal_entries!inner(entry_date, status, tenant_id, voided_at)")
        .filter("journal_entries.tenant_id", "eq", appUser?.tenant_id!);

      if (!accounts || !journalLines) throw new Error("Failed to fetch data");

      // Get existing opening balances for this period
      const { data: existingOB } = await supabase
        .from("opening_balances")
        .select("account_id, balance")
        .eq("fiscal_period_id", periodId);

      const obMap = new Map((existingOB || []).map(ob => [ob.account_id, Number(ob.balance)]));

      // Calculate balances
      const balanceMap = new Map<string, number>();
      accounts.forEach(a => balanceMap.set(a.id, obMap.get(a.id) || 0));

      const debitNormalTypes = ["Asset", "Expense", "COGS"];

      journalLines.forEach((line: any) => {
        const entry = line.journal_entries;
        if (!entry || entry.status !== "posted" || entry.voided_at) return;
        if (entry.entry_date < period.period_start || entry.entry_date > period.period_end) return;

        const current = balanceMap.get(line.account_id) || 0;
        const acct = accounts.find(a => a.id === line.account_id);
        const isDebitNormal = acct ? debitNormalTypes.includes(acct.account_type) : true;

        if (isDebitNormal) {
          balanceMap.set(line.account_id, current + Number(line.debit) - Number(line.credit));
        } else {
          balanceMap.set(line.account_id, current + Number(line.credit) - Number(line.debit));
        }
      });

      // 3. Find the next period and create opening balances
      const { data: nextPeriod } = await supabase
        .from("fiscal_periods")
        .select("id")
        .eq("tenant_id", appUser?.tenant_id!)
        .gt("period_start", period.period_end)
        .order("period_start")
        .limit(1)
        .maybeSingle();

      if (nextPeriod) {
        // Separate balance sheet accounts (carry forward) vs income/expense (close to retained earnings)
        const balanceSheetTypes = ["Asset", "Liability", "Equity"];
        const incomeExpenseTypes = ["Revenue", "Expense", "COGS"];
        
        // Calculate net income from income/expense accounts to carry to Retained Earnings
        let netIncome = 0;
        accounts.forEach(a => {
          if (incomeExpenseTypes.includes(a.account_type)) {
            const bal = balanceMap.get(a.id) || 0;
            if (a.account_type === "Revenue") {
              netIncome += bal; // Credit-normal: positive balance = income
            } else {
              netIncome -= bal; // Debit-normal: positive balance = expense
            }
          }
        });
        
        // Find the Retained Earnings account to carry net income forward
        const retainedEarningsAccount = accounts.find(a => 
          a.account_type === "Equity" && 
          (a.id === accounts.find(ac => ac.account_type === "Equity" && 
            (balanceMap.get(ac.id) !== undefined || true))?.id) &&
          // Match by common naming convention
          true
        );
        
        // Look for a "Retained Earnings" account specifically
        const { data: reAccount } = await supabase
          .from("accounts")
          .select("id")
          .eq("tenant_id", appUser?.tenant_id!)
          .eq("account_type", "Equity")
          .ilike("account_name", "%retained earnings%")
          .limit(1)
          .maybeSingle();
        
        const openingBalances: { tenant_id: string; account_id: string; fiscal_period_id: string; balance: number }[] = [];
        
        accounts.forEach(a => {
          if (balanceSheetTypes.includes(a.account_type)) {
            let bal = balanceMap.get(a.id) || 0;
            // Add net income to Retained Earnings account
            if (reAccount && a.id === reAccount.id) {
              bal += netIncome;
            }
            if (bal !== 0) {
              openingBalances.push({
                tenant_id: appUser?.tenant_id!,
                account_id: a.id,
                fiscal_period_id: nextPeriod.id,
                balance: bal,
              });
            }
          }
        });
        
        // If no Retained Earnings account found but there's net income, warn
        if (!reAccount && netIncome !== 0) {
          console.warn("No 'Retained Earnings' equity account found. Net income of", netIncome, "was not carried forward.");
        }

        if (openingBalances.length > 0) {
          const { error: obErr } = await supabase
            .from("opening_balances")
            .upsert(openingBalances, { onConflict: "account_id,fiscal_period_id" });
          if (obErr) throw obErr;
        }
      }

      // 4. Close the period
      const { error } = await supabase
        .from("fiscal_periods")
        .update({
          status: "closed",
          closed_at: new Date().toISOString(),
          closed_by: appUser?.id,
        })
        .eq("id", periodId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiscal_periods"] });
      queryClient.invalidateQueries({ queryKey: ["opening_balances"] });
      toast.success("Period closed and balances carried forward");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reopenPeriod = useMutation({
    mutationFn: async (periodId: string) => {
      const { error } = await supabase
        .from("fiscal_periods")
        .update({ status: "open", closed_at: null, closed_by: null })
        .eq("id", periodId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiscal_periods"] });
      toast.success("Period reopened");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Fiscal Periods</h1>
          <p className="page-description">Manage accounting periods, close periods, and carry forward balances</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" /> New Period</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Fiscal Period</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm font-medium">Period Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
                  placeholder="FY 2026 Q1" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Start Date</label>
                  <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
                <div>
                  <label className="text-sm font-medium">End Date</label>
                  <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
              </div>
              <Button onClick={() => createPeriod.mutate()} disabled={!name || !periodStart || !periodEnd || createPeriod.isPending} className="w-full">
                {createPeriod.isPending ? "Creating..." : "Create Period"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="stat-card">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : !periods?.length ? (
          <div className="text-center py-16">
            <Calendar className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No fiscal periods defined</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first fiscal period to enable period management.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Period Name</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Status</th>
                <th>Closed By</th>
                <th>Closed At</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p: any) => (
                <tr key={p.id}>
                  <td className="font-medium text-foreground">{p.name}</td>
                  <td className="text-muted-foreground">{p.period_start}</td>
                  <td className="text-muted-foreground">{p.period_end}</td>
                  <td>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      p.status === "closed"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-success/10 text-success"
                    }`}>
                      {p.status === "closed" ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      {p.status}
                    </span>
                  </td>
                  <td className="text-muted-foreground text-sm">
                    {p.users ? `${p.users.first_name} ${p.users.last_name}` : "—"}
                  </td>
                  <td className="text-muted-foreground text-sm">
                    {p.closed_at ? format(new Date(p.closed_at), "PPp") : "—"}
                  </td>
                  <td className="text-right">
                    {p.status === "open" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (confirm("Close this period? This will calculate closing balances and carry forward to the next period.")) {
                            closePeriod.mutate(p.id);
                          }
                        }}
                        disabled={closePeriod.isPending}
                      >
                        <Lock className="w-3 h-3 mr-1" /> Close Period
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm("Reopen this period? This is not recommended for audited periods.")) {
                            reopenPeriod.mutate(p.id);
                          }
                        }}
                        disabled={reopenPeriod.isPending}
                      >
                        <Unlock className="w-3 h-3 mr-1" /> Reopen
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
