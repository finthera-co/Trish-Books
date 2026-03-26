import { useState, useMemo, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Printer, Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { isDebitNormal, ACCOUNT_TYPES, getTypeLabel } from "@/lib/accountTypes";

interface AccountBalance {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  total_debit: number;
  total_credit: number;
}

export default function TrialBalance() {
  const navigate = useNavigate();
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: accounts, isLoading: accountsLoading } = useQuery({
    queryKey: ["tb_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, account_code, account_name, account_type")
        .order("account_code");
      if (error) throw error;
      return data;
    },
  });

  const { data: journalLines, isLoading: linesLoading } = useQuery({
    queryKey: ["tb_journal_lines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_lines")
        .select("account_id, debit, credit, journal_entries!inner(entry_date, status, entry_type)");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: fiscalPeriods } = useQuery({
    queryKey: ["tb_fiscal_periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fiscal_periods")
        .select("id, period_start, period_end, status")
        .order("period_start", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const matchingPeriod = useMemo(() => {
    if (!fiscalPeriods) return null;
    return fiscalPeriods.find(p => p.period_start <= asOfDate && p.period_end >= asOfDate) || null;
  }, [fiscalPeriods, asOfDate]);

  const balances: AccountBalance[] = useMemo(() => {
    if (!accounts || !journalLines) return [];

    const map = new Map<string, AccountBalance>();
    accounts.forEach(a =>
      map.set(a.id, {
        id: a.id,
        account_code: a.account_code,
        account_name: a.account_name,
        account_type: a.account_type,
        total_debit: 0,
        total_credit: 0,
      })
    );

    // Journal lines are the single source of truth — opening_balance type
    // journal entries are already included, so do NOT add opening_balances table on top.
    journalLines.forEach(line => {
      const entryDate = line.journal_entries?.entry_date;
      const status = line.journal_entries?.status;
      if (!entryDate || entryDate > asOfDate) return;
      if (status !== "posted") return;
      if (matchingPeriod && entryDate < matchingPeriod.period_start) return;

      const acc = map.get(line.account_id);
      if (acc) {
        acc.total_debit += Number(line.debit) || 0;
        acc.total_credit += Number(line.credit) || 0;
      }
    });

    return Array.from(map.values()).filter(a => a.total_debit > 0 || a.total_credit > 0);
  }, [accounts, journalLines, asOfDate, matchingPeriod]);

  // Calculate totals — journal lines are the single source, no separate opening balance addition
  const { totalDebit, totalCredit } = useMemo(() => {
    let dr = 0, cr = 0;
    balances.forEach(a => {
      dr += a.total_debit;
      cr += a.total_credit;
    });
    return { totalDebit: dr, totalCredit: cr };
  }, [balances]);

  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
  const isLoading = accountsLoading || linesLoading;

  // Group by account type
  const grouped = useMemo(() => {
    const order = [...ACCOUNT_TYPES];
    const groups = new Map<string, AccountBalance[]>();
    balances.forEach(b => {
      if (!groups.has(b.account_type)) groups.set(b.account_type, []);
      groups.get(b.account_type)!.push(b);
    });
    return order
      .filter(t => groups.has(t))
      .map(t => ({ type: t, accounts: groups.get(t)! }));
  }, [balances]);

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Get effective debit/credit for display — journal lines are single source of truth
  const getEffectiveAmounts = (a: AccountBalance) => {
    return { debit: a.total_debit, credit: a.total_credit };
  };

  const handleExportCSV = () => {
    const rows = [
      ["Account Code", "Account Name", "Type", "Debit", "Credit", "Net Balance"],
      ...balances.map(a => {
        const eff = getEffectiveAmounts(a);
        return [
          a.account_code, a.account_name, a.account_type,
          eff.debit.toFixed(2), eff.credit.toFixed(2),
          (eff.debit - eff.credit).toFixed(2),
        ];
      }),
      ["", "", "TOTALS", totalDebit.toFixed(2), totalCredit.toFixed(2), (totalDebit - totalCredit).toFixed(2)],
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trial-balance-${asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Trial Balance</h1>
          <p className="page-description">Verify that total debits equal total credits across all accounts</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => navigate("/journals")} className="print:hidden">
            <Plus className="w-4 h-4 mr-1" /> Create Journal Entry
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={balances.length === 0}>
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
        </div>
      </div>

      {/* Date filter */}
      <div className="flex items-center gap-3 print:hidden">
        <label className="text-sm font-medium text-foreground">As of date:</label>
        <input
          type="date"
          value={asOfDate}
          onChange={e => setAsOfDate(e.target.value)}
          className="text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
        />
        {matchingPeriod && (
          <span className="text-xs text-muted-foreground bg-info/10 text-info px-2 py-1 rounded">
            Period: {matchingPeriod.period_start} to {matchingPeriod.period_end}
          </span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Debits</p>
          <p className="text-xl font-bold text-foreground mt-1">LKR {fmt(totalDebit)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Credits</p>
          <p className="text-xl font-bold text-foreground mt-1">LKR {fmt(totalCredit)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Difference</p>
          <p className={`text-xl font-bold mt-1 ${isBalanced ? "text-success" : "text-destructive"}`}>
            LKR {fmt(Math.abs(totalDebit - totalCredit))}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Status</p>
          <div className={`mt-1 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${isBalanced ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
            {isBalanced ? "✓ Balanced" : "✗ Unbalanced"}
          </div>
        </div>
      </div>

      {/* Trial Balance table */}
      <div className="stat-card print:shadow-none">
        <div className="text-center mb-6 print:mb-4">
          <h2 className="text-lg font-bold text-foreground">Trial Balance</h2>
          <p className="text-sm text-muted-foreground">As of {format(new Date(asOfDate), "MMMM d, yyyy")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Only posted journal entries included
            {matchingPeriod && " • Opening balances applied"}
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : balances.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No posted journal entries found</p>
            <p className="text-sm text-muted-foreground mt-1">Post journal entries to generate the trial balance.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-28">Code</th>
                <th>Account Name</th>
                <th className="w-28">Type</th>
                <th className="text-right w-32">Opening Bal.</th>
                <th className="text-right w-36">Debit</th>
                <th className="text-right w-36">Credit</th>
                <th className="text-right w-36">Net Balance</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(group => (
                <Fragment key={group.type}>
                  <tr>
                    <td colSpan={7} className="font-semibold text-foreground bg-muted/40 py-2 text-xs uppercase tracking-wide">
                      {group.type}
                    </td>
                  </tr>
                  {group.accounts.sort((a, b) => a.account_code.localeCompare(b.account_code)).map(a => {
                    const eff = getEffectiveAmounts(a);
                    const net = eff.debit - eff.credit;
                    return (
                      <tr key={a.id}>
                        <td className="font-mono text-xs text-muted-foreground">{a.account_code}</td>
                        <td className="font-medium text-foreground">{a.account_name}</td>
                        <td>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                            {a.account_type}
                          </span>
                        </td>
                        <td className="text-right font-mono tabular-nums text-muted-foreground">
                          {a.opening_balance !== 0 ? `LKR ${fmt(a.opening_balance)}` : "—"}
                        </td>
                        <td className="text-right font-mono tabular-nums">{eff.debit > 0 ? `LKR ${fmt(eff.debit)}` : "—"}</td>
                        <td className="text-right font-mono tabular-nums">{eff.credit > 0 ? `LKR ${fmt(eff.credit)}` : "—"}</td>
                        <td className={`text-right font-mono tabular-nums font-medium ${net >= 0 ? "text-foreground" : "text-destructive"}`}>
                          {net < 0 ? `(LKR ${fmt(Math.abs(net))})` : `LKR ${fmt(net)}`}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold border-t-2 border-foreground/20">
                <td colSpan={4} className="text-foreground">Totals</td>
                <td className="text-right font-mono tabular-nums text-foreground">LKR {fmt(totalDebit)}</td>
                <td className="text-right font-mono tabular-nums text-foreground">LKR {fmt(totalCredit)}</td>
                <td className={`text-right font-mono tabular-nums ${isBalanced ? "text-primary" : "text-destructive"}`}>
                  LKR {fmt(Math.abs(totalDebit - totalCredit))}
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {balances.length > 0 && (
          <div className={`mt-4 px-4 py-2.5 rounded-lg text-sm font-medium ${isBalanced ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
            {isBalanced
              ? "✓ Trial balance is in balance — total debits equal total credits"
              : `✗ Out of balance by LKR ${fmt(Math.abs(totalDebit - totalCredit))}. Review journal entries for errors.`}
          </div>
        )}
      </div>
    </div>
  );
}