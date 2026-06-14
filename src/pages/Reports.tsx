import { useState, useMemo, useEffect, Fragment } from "react";
import { FileText, TrendingUp, DollarSign, BarChart3, Printer, ArrowLeft, Activity, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccounts, useJournalEntries, useInvoices, useExpenses, useBudgets } from "@/hooks/useData";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { format } from "date-fns";
import { isDebitNormal as checkDebitNormal } from "@/lib/accountTypes";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { buildScheduleBlocks, deriveFYWindow, fyLabel, type AssetMeta } from "@/lib/ppeSchedule";

type ReportType = "trial-balance" | "pnl" | "balance-sheet" | "cash-flow" | "expense-summary" | "aged-receivables" | "fixed-asset-schedule" | "ppe-schedule" | null;

const COLORS = ["hsl(215, 60%, 42%)", "hsl(142, 71%, 35%)", "hsl(38, 92%, 50%)", "hsl(199, 89%, 48%)", "hsl(0, 72%, 51%)", "hsl(270, 60%, 50%)"];

export default function Reports() {
  const { appUser } = useAuth();
  const [searchParams] = useSearchParams();
  const reportParam = searchParams.get("report") as ReportType | null;

  const [activeReport, setActiveReport] = useState<ReportType>(null);
  const [periodFrom, setPeriodFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 12); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [periodTo, setPeriodTo] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (reportParam && !activeReport) setActiveReport(reportParam);
  }, [reportParam]);

  const { data: accounts } = useAccounts();
  const { data: journalEntries } = useJournalEntries();
  const { data: invoices } = useInvoices();
  const { data: expenses } = useExpenses();
  const { data: budgets } = useBudgets();

  // Fetch fiscal periods to find the matching period for opening balances
  const { data: fiscalPeriods } = useQuery({
    queryKey: ["fiscal_periods_for_reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fiscal_periods")
        .select("id, name, period_start, period_end, status")
        .order("period_start", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Fetch all opening balances
  const { data: allOpeningBalances } = useQuery({
    queryKey: ["opening_balances_for_reports"],
    queryFn: async () => {
      const { data, error } = await supabase.from("opening_balances").select("*");
      if (error) throw error;
      return data;
    },
  });

  // Fixed Asset Schedule data
  const { data: assetScheduleData } = useQuery({
    queryKey: ["fixed_asset_schedule", appUser?.tenant_id, periodTo, periodFrom],
    enabled: !!appUser?.tenant_id && activeReport === "fixed-asset-schedule",
    queryFn: async () => {
      const { data: assets, error: aErr } = await supabase
        .from("fixed_assets")
        .select("id, asset_name, category_id, acquisition_date, cost, salvage_value, useful_life_months, status, accumulated_depreciation, asset_account_id")
        .eq("tenant_id", appUser!.tenant_id)
        .order("acquisition_date", { ascending: true });
      if (aErr) throw aErr;

      const periodYYYYMM = periodTo.slice(0, 7);
      const { data: depRows, error: dErr } = await supabase
        .from("asset_depreciation")
        .select("asset_id, period, depreciation_amount, accumulated_depreciation")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("status", "posted")
        .lte("period", periodYYYYMM)
        .order("period", { ascending: true });
      if (dErr) throw dErr;

      const { data: categories } = await supabase
        .from("asset_categories")
        .select("id, name")
        .eq("tenant_id", appUser!.tenant_id);

      const categoryMap = new Map((categories ?? []).map((c: any) => [c.id, c.name]));

      // Latest accumulated_depreciation per asset as at period end
      const depByAsset = new Map<string, number>();
      (depRows ?? []).forEach((row: any) => {
        if ((row.accumulated_depreciation ?? 0) > (depByAsset.get(row.asset_id) ?? 0)) {
          depByAsset.set(row.asset_id, row.accumulated_depreciation);
        }
      });

      // Depreciation charge within the selected period window
      const periodFromYYYYMM = periodFrom.slice(0, 7);
      const depInPeriodByAsset = new Map<string, number>();
      (depRows ?? []).forEach((row: any) => {
        if (row.period >= periodFromYYYYMM && row.period <= periodYYYYMM) {
          depInPeriodByAsset.set(row.asset_id, (depInPeriodByAsset.get(row.asset_id) ?? 0) + row.depreciation_amount);
        }
      });

      return (assets ?? []).map((asset: any) => {
        const accumDep = depByAsset.get(asset.id) ?? asset.accumulated_depreciation ?? 0;
        return {
          id: asset.id,
          asset_name: asset.asset_name,
          category: categoryMap.get(asset.category_id) ?? "—",
          acquisition_date: asset.acquisition_date,
          cost: asset.cost,
          salvage_value: asset.salvage_value ?? 0,
          useful_life_months: asset.useful_life_months ?? 0,
          accumulated_depreciation: accumDep,
          depreciation_in_period: depInPeriodByAsset.get(asset.id) ?? 0,
          net_book_value: asset.cost - accumDep,
          status: asset.status,
          depreciation_pct: asset.cost > 0 ? (accumDep / asset.cost) * 100 : 0,
        };
      });
    },
  });

  // PPE Schedule (Excel-style, per-fiscal-year depreciation) data
  const { data: ppeScheduleData } = useQuery({
    queryKey: ["ppe_schedule", appUser?.tenant_id, periodTo],
    enabled: !!appUser?.tenant_id && activeReport === "ppe-schedule",
    queryFn: async () => {
      const asOf = periodTo.slice(0, 7);

      const { data: assets, error: aErr } = await supabase
        .from("fixed_assets")
        // NB: no `supplier` column on fixed_assets — Supplier renders as "-".
        .select("id, asset_name, category_id, cost, salvage_value, acquisition_date, start_date, status, accumulated_depreciation, useful_life_months")
        .eq("tenant_id", appUser!.tenant_id)
        .order("acquisition_date", { ascending: true });
      if (aErr) throw aErr;

      const { data: depRows, error: dErr } = await supabase
        .from("asset_depreciation")
        .select("asset_id, period, depreciation_amount, accumulated_depreciation")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("status", "posted")
        .lte("period", asOf)
        .order("period", { ascending: true });
      if (dErr) throw dErr;

      const { data: categories } = await supabase
        .from("asset_categories")
        .select("id, name")
        .eq("tenant_id", appUser!.tenant_id);

      const { data: disposals } = await supabase
        .from("asset_disposals")
        .select("asset_id, disposal_date")
        .eq("tenant_id", appUser!.tenant_id);

      const postedRows = (depRows ?? []).map((r) => ({
        asset_id: r.asset_id,
        period: r.period,
        depreciation_amount: Number(r.depreciation_amount) || 0,
        accumulated_depreciation: Number(r.accumulated_depreciation) || 0,
      }));

      const fyStartYears = deriveFYWindow(postedRows.map((r) => r.period), asOf);

      const assetMeta: AssetMeta[] = (assets ?? []).map((a) => ({
        id: a.id,
        asset_name: a.asset_name,
        category_id: a.category_id,
        supplier: null,
        cost: Number(a.cost) || 0,
        salvage_value: Number(a.salvage_value) || 0,
        acquisition_date: a.acquisition_date,
        start_date: a.start_date,
        status: a.status,
        accumulated_depreciation: Number(a.accumulated_depreciation) || 0,
      }));

      const blocks = buildScheduleBlocks({
        assets: assetMeta,
        postedRows,
        categories: (categories ?? []).map((c) => ({ id: c.id, name: c.name })),
        disposals: (disposals ?? []).map((d) => ({ asset_id: d.asset_id, disposal_date: d.disposal_date })),
        fyStartYears,
      });

      // Effective depreciation rate for display only (12 / useful life) — never charge math.
      const rateMap = new Map<string, number>();
      (assets ?? []).forEach((a) => rateMap.set(a.id, Number(a.useful_life_months) || 0));

      const fyLabels = fyStartYears.map(fyLabel);
      const totals = {
        cost: blocks.reduce((s, b) => s + b.totals.cost, 0),
        fyCharges: fyLabels.map((_, i) => blocks.reduce((s, b) => s + (b.totals.fyCharges[i] ?? 0), 0)),
        accumulated: blocks.reduce((s, b) => s + b.totals.accumulated, 0),
        wdv: blocks.reduce((s, b) => s + b.totals.wdv, 0),
      };

      return {
        blocks,
        fyLabels,
        rateMap,
        hasAssets: (assets ?? []).length > 0,
        hasPosted: postedRows.length > 0,
        windowStartLabel: `${fyStartYears[0]}/04/01`,
        totals,
      };
    },
  });

  // Find the fiscal period that best matches the report date range
  const matchingPeriod = useMemo(() => {
    if (!fiscalPeriods) return null;
    // Find period whose start date is closest to (and <= ) periodFrom
    return fiscalPeriods.find(p => p.period_start <= periodFrom && p.period_end >= periodFrom)
      || fiscalPeriods.find(p => p.period_start >= periodFrom && p.period_start <= periodTo)
      || null;
  }, [fiscalPeriods, periodFrom, periodTo]);

  // Build opening balance map for the matching period
  const openingBalanceMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!matchingPeriod || !allOpeningBalances) return m;
    allOpeningBalances
      .filter(ob => ob.fiscal_period_id === matchingPeriod.id)
      .forEach(ob => m.set(ob.account_id, Number(ob.balance)));
    return m;
  }, [matchingPeriod, allOpeningBalances]);

  // Filter journal entries by period
  const filteredEntries = useMemo(() => {
    return journalEntries?.filter(e => 
      e.status === "posted" && 
      !(e as any).voided_at &&
      e.entry_date >= periodFrom && 
      e.entry_date <= periodTo
    ) || [];
  }, [journalEntries, periodFrom, periodTo]);

  // Build account balances from opening balances + filtered journal lines
  const accountBalances = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code: string; type: string; subledger_type: string | null; debit: number; credit: number; openingBalance: number }>();
    accounts?.forEach(a => {
      const ob = openingBalanceMap.get(a.id) || 0;
      map.set(a.id, { id: a.id, name: a.account_name, code: a.account_code, type: a.account_type, subledger_type: (a as any).subledger_type ?? null, debit: 0, credit: 0, openingBalance: ob });
    });
    filteredEntries.forEach(entry => {
      ((entry.journal_lines as any[]) || []).forEach(line => {
        const acc = map.get(line.account_id);
        if (acc) {
          acc.debit += Number(line.debit) || 0;
          acc.credit += Number(line.credit) || 0;
        }
      });
    });
    return map;
  }, [accounts, filteredEntries, openingBalanceMap]);

  const balances = Array.from(accountBalances.values()).filter(a => a.debit > 0 || a.credit > 0 || a.openingBalance !== 0);

  const reports = [
    { id: "trial-balance" as ReportType, name: "Trial Balance", description: "Verify total debits equal total credits across all accounts", icon: FileText, category: "Accounting" },
    { id: "pnl" as ReportType, name: "Income Statement", description: "Revenue, cost of goods sold, operating expenses, and net income", icon: TrendingUp, category: "Financial Statement" },
    { id: "balance-sheet" as ReportType, name: "Balance Sheet", description: "Statement of financial position — assets, liabilities, and equity", icon: DollarSign, category: "Financial Statement" },
    { id: "cash-flow" as ReportType, name: "Cash Flow Statement", description: "Cash inflows and outflows from operating, investing, and financing", icon: Activity, category: "Financial Statement" },
    { id: "expense-summary" as ReportType, name: "Expense Analysis", description: "Expense breakdown by category, status, and trends", icon: BarChart3, category: "Management" },
    { id: "aged-receivables" as ReportType, name: "Aged Receivables", description: "Outstanding customer invoices analyzed by aging buckets", icon: FileText, category: "Management" },
    { id: "fixed-asset-schedule" as ReportType, name: "Fixed Asset Schedule", description: "Property, plant & equipment — cost, accumulated depreciation and net book value by asset", icon: Warehouse, category: "Fixed Assets" },
    { id: "ppe-schedule" as ReportType, name: "PPE Schedule", description: "Property, plant & equipment by category with per-fiscal-year depreciation, accumulated depreciation and written-down value (IAS 16)", icon: Warehouse, category: "Fixed Assets" },
  ];

  const fmt = (n: number) => {
    const abs = Math.abs(n);
    const str = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? `(LKR ${str})` : `LKR ${str}`;
  };

  const StatementHeader = ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div className="text-center mb-6 print:mb-4">
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      <p className="text-xs text-muted-foreground mt-1">
        Period: {format(new Date(periodFrom), "MMM d, yyyy")} — {format(new Date(periodTo), "MMM d, yyyy")}
      </p>
    </div>
  );

  const renderTrialBalance = () => {
    const sorted = [...balances].sort((a, b) => a.code.localeCompare(b.code));
    
    // Include opening balances in debit/credit totals (industry standard)
    const getEffectiveAmounts = (a: typeof balances[0]) => {
      const isDebitNormal = checkDebitNormal(a.type);
      let dr = a.debit;
      let cr = a.credit;
      if (a.openingBalance > 0) {
        if (isDebitNormal) dr += a.openingBalance;
        else cr += a.openingBalance;
      } else if (a.openingBalance < 0) {
        if (isDebitNormal) cr += Math.abs(a.openingBalance);
        else dr += Math.abs(a.openingBalance);
      }
      return { debit: dr, credit: cr };
    };
    
    let totalDebit = 0, totalCredit = 0;
    sorted.forEach(a => {
      const eff = getEffectiveAmounts(a);
      totalDebit += eff.debit;
      totalCredit += eff.credit;
    });
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
    
    return (
      <div className="stat-card print:shadow-none">
        <StatementHeader title="Trial Balance" />
        {sorted.length === 0 ? (
          <p className="text-center py-12 text-muted-foreground">No journal entries found for this period. Post journal entries to generate the trial balance.</p>
        ) : (
          <>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-24">Code</th>
                  <th>Account Name</th>
                  <th className="w-28">Type</th>
                  <th className="text-right w-32">Debit</th>
                  <th className="text-right w-32">Credit</th>
                  <th className="text-right w-32">Net Balance</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((a, i) => {
                  const eff = getEffectiveAmounts(a);
                  const net = eff.debit - eff.credit;
                  return (
                    <tr key={i}>
                      <td className="font-mono text-xs text-muted-foreground">{a.code}</td>
                      <td className="font-medium text-foreground">{a.name}</td>
                      <td><span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">{a.type}</span></td>
                      <td className="text-right font-mono">{eff.debit > 0 ? fmt(eff.debit) : "—"}</td>
                      <td className="text-right font-mono">{eff.credit > 0 ? fmt(eff.credit) : "—"}</td>
                      <td className={`text-right font-mono font-medium ${net >= 0 ? "text-foreground" : "text-destructive"}`}>{fmt(net)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2 border-foreground/20">
                  <td colSpan={3} className="text-foreground">Totals</td>
                  <td className="text-right font-mono text-foreground">{fmt(totalDebit)}</td>
                  <td className="text-right font-mono text-foreground">{fmt(totalCredit)}</td>
                  <td className="text-right font-mono text-foreground">{fmt(totalDebit - totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
            <div className={`mt-4 px-4 py-2 rounded-md text-sm font-medium ${isBalanced ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
              {isBalanced ? "✓ Trial balance is in balance — debits equal credits" : `✗ Out of balance by ${fmt(Math.abs(totalDebit - totalCredit))}`}
            </div>
          </>
        )}
      </div>
    );
  };

  const renderPnL = () => {
    const revenue = balances.filter(a => a.type === "Income" || a.type === "Revenue");
    const cogs = balances.filter(a => a.type === "Cost of Goods Sold" || a.type === "COGS");
    const opex = balances.filter(a => a.type === "Expense");
    const otherIncome = balances.filter(a => a.type === "Other Income");
    const otherExpense = balances.filter(a => a.type === "Other Expense");
    
    const totalRevenue = revenue.reduce((s, a) => s + (a.credit - a.debit), 0);
    const totalCOGS = cogs.reduce((s, a) => s + (a.debit - a.credit), 0);
    const grossProfit = totalRevenue - totalCOGS;
    const totalOpex = opex.reduce((s, a) => s + (a.debit - a.credit), 0);
    const operatingIncome = grossProfit - totalOpex;
    const totalOtherIncome = otherIncome.reduce((s, a) => s + (a.credit - a.debit), 0);
    const totalOtherExpense = otherExpense.reduce((s, a) => s + (a.debit - a.credit), 0);
    const netIncome = operatingIncome + totalOtherIncome - totalOtherExpense;
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const netMargin = totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0;

    const Section = ({ title, items, sign }: { title: string; items: typeof revenue; sign: "credit" | "debit" }) => (
      <>
        <tr><td colSpan={2} className="font-semibold text-foreground bg-muted/40 py-2">{title}</td></tr>
        {items.map((a, i) => {
          const amount = sign === "credit" ? a.credit - a.debit : a.debit - a.credit;
          return (
            <tr key={i}>
              <td className="pl-8 text-foreground">{a.name}</td>
              <td className="text-right font-mono">{fmt(amount)}</td>
            </tr>
          );
        })}
      </>
    );

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Revenue</p><p className="text-xl font-bold text-foreground mt-1">{fmt(totalRevenue)}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Gross Profit</p><p className="text-xl font-bold text-foreground mt-1">{fmt(grossProfit)}</p><p className="text-xs text-muted-foreground">{grossMargin.toFixed(1)}% margin</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Operating Income</p><p className={`text-xl font-bold mt-1 ${operatingIncome >= 0 ? "text-success" : "text-destructive"}`}>{fmt(operatingIncome)}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Net Income</p><p className={`text-xl font-bold mt-1 ${netIncome >= 0 ? "text-success" : "text-destructive"}`}>{fmt(netIncome)}</p><p className="text-xs text-muted-foreground">{netMargin.toFixed(1)}% margin</p></div>
        </div>

        <div className="stat-card print:shadow-none">
          <StatementHeader title="Income Statement (Profit & Loss)" subtitle="Statement of Comprehensive Income" />
          {revenue.length === 0 && opex.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No revenue or expense entries found for this period.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>Account</th><th className="text-right w-40">Amount</th></tr></thead>
              <tbody>
                {revenue.length > 0 && <Section title="Revenue" items={revenue} sign="credit" />}
                {revenue.length > 0 && (
                  <tr className="font-semibold border-t"><td className="pl-4">Total Revenue</td><td className="text-right font-mono">{fmt(totalRevenue)}</td></tr>
                )}
                
                {cogs.length > 0 && <Section title="Cost of Goods Sold" items={cogs} sign="debit" />}
                {cogs.length > 0 && (
                  <tr className="font-semibold border-t"><td className="pl-4">Total COGS</td><td className="text-right font-mono text-destructive">({fmt(totalCOGS)})</td></tr>
                )}
                
                <tr className="font-bold border-t-2 border-foreground/20 bg-muted/20">
                  <td>Gross Profit</td>
                  <td className={`text-right font-mono ${grossProfit >= 0 ? "text-success" : "text-destructive"}`}>{fmt(grossProfit)}</td>
                </tr>

                {opex.length > 0 && <Section title="Operating Expenses" items={opex} sign="debit" />}
                {opex.length > 0 && (
                  <tr className="font-semibold border-t"><td className="pl-4">Total Operating Expenses</td><td className="text-right font-mono text-destructive">({fmt(totalOpex)})</td></tr>
                )}

                <tr className="font-bold border-t-2 border-foreground/20 bg-muted/20">
                  <td>Operating Income</td>
                  <td className={`text-right font-mono ${operatingIncome >= 0 ? "text-success" : "text-destructive"}`}>{fmt(operatingIncome)}</td>
                </tr>

                {otherIncome.length > 0 && <Section title="Other Income" items={otherIncome} sign="credit" />}
                {otherExpense.length > 0 && <Section title="Other Expense" items={otherExpense} sign="debit" />}

                <tr className="font-bold text-base border-t-2 border-foreground/30 bg-primary/5">
                  <td>Net Income</td>
                  <td className={`text-right font-mono ${netIncome >= 0 ? "text-success" : "text-destructive"}`}>{fmt(netIncome)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  const renderBalanceSheet = () => {
    const allAssets = balances.filter(a => a.type === "Asset");
    const ppeAccounts = allAssets.filter(a => a.subledger_type === "fixed_asset");
    const accumDepAccounts = allAssets.filter(a => a.subledger_type === "asset_depreciation");
    const currentAssets = allAssets.filter(
      a => a.subledger_type !== "fixed_asset" && a.subledger_type !== "asset_depreciation"
    );

    const liabilities = balances.filter(a => a.type === "Liability");
    const equity = balances.filter(a => a.type === "Equity");

    // Helper to get net balance including opening balance
    const getNetBalance = (a: typeof balances[0]) => {
      const isDebitNormal = checkDebitNormal(a.type);
      const journalNet = isDebitNormal ? (a.debit - a.credit) : (a.credit - a.debit);
      return a.openingBalance + journalNet;
    };

    // Retained earnings = net income (revenue credits - expense debits)
    const revenue = balances.filter(a => a.type === "Income" || a.type === "Revenue" || a.type === "Other Income");
    const expenseAccounts = balances.filter(a => a.type === "Expense" || a.type === "Cost of Goods Sold" || a.type === "COGS" || a.type === "Other Expense");
    const retainedEarnings = revenue.reduce((s, a) => s + (a.credit - a.debit), 0) - expenseAccounts.reduce((s, a) => s + (a.debit - a.credit), 0);

    const grossPPE = ppeAccounts.reduce((s, a) => s + getNetBalance(a), 0);
    // Accumulated depreciation accounts are credit-normal (contra-asset).
    // getNetBalance returns positive = credit balance, representing the accumulated amount.
    const totalAccumDep = accumDepAccounts.reduce((s, a) => s + getNetBalance(a), 0);
    const netPPE = grossPPE - totalAccumDep;
    const totalCurrentAssets = currentAssets.reduce((s, a) => s + getNetBalance(a), 0);
    const totalAssets = totalCurrentAssets + netPPE;

    const totalLiabilities = liabilities.reduce((s, a) => s + getNetBalance(a), 0);
    const totalEquity = equity.reduce((s, a) => s + getNetBalance(a), 0) + retainedEarnings;
    const totalLiabEquity = totalLiabilities + totalEquity;

    const pieData = [
      { name: "Assets", value: Math.abs(totalAssets) },
      { name: "Liabilities", value: Math.abs(totalLiabilities) },
      { name: "Equity", value: Math.abs(totalEquity) },
    ].filter(d => d.value > 0);

    const SectionRows = ({ items, sign }: { items: typeof allAssets; sign: "debit" | "credit" }) => (
      <>
        {items.map((a, i) => {
          const bal = getNetBalance(a);
          return (
            <tr key={i}>
              <td className="pl-8 text-foreground">{a.name}</td>
              <td className="text-right font-mono">{fmt(bal)}</td>
            </tr>
          );
        })}
      </>
    );

    const hasAssetData = allAssets.length > 0;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Total Assets</p><p className="text-xl font-bold text-foreground mt-1">{fmt(totalAssets)}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Total Liabilities</p><p className="text-xl font-bold text-foreground mt-1">{fmt(totalLiabilities)}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Total Equity</p><p className="text-xl font-bold text-primary mt-1">{fmt(totalEquity)}</p></div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 stat-card print:shadow-none">
            <StatementHeader title="Statement of Financial Position" subtitle="Balance Sheet" />
            {!hasAssetData && liabilities.length === 0 && equity.length === 0 ? (
              <p className="text-center py-12 text-muted-foreground">No balance sheet data. Create accounts and post journal entries.</p>
            ) : (
              <table className="data-table">
                <thead><tr><th>Account</th><th className="text-right w-40">Balance</th></tr></thead>
                <tbody>
                  {hasAssetData && <tr><td colSpan={2} className="font-semibold text-foreground bg-muted/40 py-2">Assets</td></tr>}

                  {/* Current Assets */}
                  {currentAssets.length > 0 && (
                    <>
                      <tr className="bg-muted/30">
                        <td colSpan={2} className="font-semibold text-foreground text-sm py-1.5 pl-2">Current Assets</td>
                      </tr>
                      <SectionRows items={currentAssets} sign="debit" />
                      <tr className="border-t border-border/50">
                        <td className="pl-4 text-sm text-muted-foreground italic">Total Current Assets</td>
                        <td className="text-right font-mono font-semibold">{fmt(totalCurrentAssets)}</td>
                      </tr>
                    </>
                  )}

                  {/* Non-Current Assets — Property, Plant & Equipment */}
                  {(ppeAccounts.length > 0 || accumDepAccounts.length > 0) && (
                    <>
                      <tr className="bg-muted/30">
                        <td colSpan={2} className="font-semibold text-foreground text-sm py-1.5 pl-2">
                          Non-Current Assets — Property, Plant &amp; Equipment
                        </td>
                      </tr>
                      <SectionRows items={ppeAccounts} sign="debit" />
                      {accumDepAccounts.map((a, i) => {
                        const bal = getNetBalance(a);
                        return (
                          <tr key={`accum-${i}`}>
                            <td className="pl-8 text-foreground italic text-sm">Less: {a.name}</td>
                            <td className="text-right font-mono text-destructive/80">({fmt(bal)})</td>
                          </tr>
                        );
                      })}
                      <tr className="border-t border-border/50">
                        <td className="pl-4 text-sm text-muted-foreground italic">Net Book Value — PPE</td>
                        <td className={`text-right font-mono font-semibold ${netPPE >= 0 ? "" : "text-destructive"}`}>
                          {fmt(netPPE)}
                        </td>
                      </tr>
                    </>
                  )}

                  <tr className="font-bold border-t-2 border-foreground/30">
                    <td>Total Assets</td>
                    <td className="text-right font-mono">{fmt(totalAssets)}</td>
                  </tr>
                  
                  {liabilities.length > 0 && <tr><td colSpan={2} className="font-semibold text-foreground bg-muted/40 py-2">Liabilities</td></tr>}
                  <SectionRows items={liabilities} sign="credit" />
                  {liabilities.length > 0 && <tr className="font-semibold border-t"><td className="pl-4">Total Liabilities</td><td className="text-right font-mono">{fmt(totalLiabilities)}</td></tr>}

                  <tr><td colSpan={2} className="font-semibold text-foreground bg-muted/40 py-2">Equity</td></tr>
                  <SectionRows items={equity} sign="credit" />
                  {retainedEarnings !== 0 && (
                    <tr><td className="pl-8 text-foreground italic">Retained Earnings (Current Period)</td><td className="text-right font-mono">{fmt(retainedEarnings)}</td></tr>
                  )}
                  <tr className="font-semibold border-t"><td className="pl-4">Total Equity</td><td className="text-right font-mono">{fmt(totalEquity)}</td></tr>

                  <tr className="font-bold border-t-2 border-foreground/30 bg-primary/5">
                    <td>Total Liabilities & Equity</td>
                    <td className="text-right font-mono">{fmt(totalLiabEquity)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            <div className={`mt-4 px-4 py-2 rounded-md text-sm font-medium ${Math.abs(totalAssets - totalLiabEquity) < 0.01 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
              {Math.abs(totalAssets - totalLiabEquity) < 0.01 ? "✓ Balance sheet is balanced — Assets = Liabilities + Equity" : `✗ Out of balance by ${fmt(Math.abs(totalAssets - totalLiabEquity))}`}
            </div>
          </div>

          {pieData.length > 0 && (
            <div className="stat-card print:hidden">
              <h3 className="text-sm font-medium text-foreground mb-4">Composition</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} innerRadius={40} dataKey="value" label={({ name, value }) => `${name}: ${fmt(value)}`}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderCashFlow = () => {
    // Classify cash flows based on account types — Direct Method
    const cashAccounts = balances.filter(a => 
      a.name.toLowerCase().includes("cash") || a.name.toLowerCase().includes("bank")
    );
    
    // Beginning cash = sum of opening balances for cash/bank accounts
    const beginningCash = cashAccounts.reduce((s, a) => {
      const isDebitNormal = checkDebitNormal(a.type);
      return s + (isDebitNormal ? a.openingBalance : -a.openingBalance);
    }, 0);
    
    // Build monthly cash flow data
    const monthlyData = new Map<string, { operating: number; investing: number; financing: number }>();
    filteredEntries.forEach(entry => {
      const month = entry.entry_date.slice(0, 7); // YYYY-MM
      if (!monthlyData.has(month)) monthlyData.set(month, { operating: 0, investing: 0, financing: 0 });
      const m = monthlyData.get(month)!;
      
      const lines = (entry.journal_lines as any[]) || [];
      lines.forEach(line => {
        const acc = accountBalances.get(line.account_id);
        if (!acc) return;
        const net = (Number(line.debit) || 0) - (Number(line.credit) || 0);
        // Only track cash movements (lines hitting cash/bank accounts)
        const isCash = acc.name.toLowerCase().includes("cash") || acc.name.toLowerCase().includes("bank");
        if (!isCash) return;
        
        // Classify based on the OTHER side of the entry
        const otherLines = lines.filter(l => l.account_id !== line.account_id);
        const otherTypes = otherLines.map(l => accountBalances.get(l.account_id)?.type).filter(Boolean);
        
        if (otherTypes.some(t => t === "Revenue" || t === "Expense" || t === "COGS")) {
          m.operating += net;
        } else if (otherTypes.some(t => t === "Asset")) {
          m.investing += net;
        } else if (otherTypes.some(t => t === "Liability" || t === "Equity")) {
          m.financing += net;
        } else {
          m.operating += net; // default to operating
        }
      });
    });

    const sortedMonths = Array.from(monthlyData.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month: format(new Date(month + "-01"), "MMM yyyy"),
        ...data,
        total: data.operating + data.investing + data.financing,
      }));

    // Running totals
    let runningTotal = beginningCash;
    const chartData = sortedMonths.map(d => {
      runningTotal += d.total;
      return { ...d, cumulative: runningTotal };
    });

    const totalOperating = sortedMonths.reduce((s, d) => s + d.operating, 0);
    const totalInvesting = sortedMonths.reduce((s, d) => s + d.investing, 0);
    const totalFinancing = sortedMonths.reduce((s, d) => s + d.financing, 0);
    const netChange = totalOperating + totalInvesting + totalFinancing;
    
    const endingCash = beginningCash + netChange;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Operating</p><p className={`text-xl font-bold mt-1 ${totalOperating >= 0 ? "text-success" : "text-destructive"}`}>{fmt(totalOperating)}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Investing</p><p className={`text-xl font-bold mt-1 ${totalInvesting >= 0 ? "text-success" : "text-destructive"}`}>{fmt(totalInvesting)}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Financing</p><p className={`text-xl font-bold mt-1 ${totalFinancing >= 0 ? "text-success" : "text-destructive"}`}>{fmt(totalFinancing)}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Net Change</p><p className={`text-xl font-bold mt-1 ${netChange >= 0 ? "text-success" : "text-destructive"}`}>{fmt(netChange)}</p></div>
        </div>

        {chartData.length > 0 && (
          <div className="stat-card print:hidden">
            <h3 className="text-sm font-medium text-foreground mb-4">Cash Flow Trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `LKR ${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Line type="monotone" dataKey="operating" name="Operating" stroke={COLORS[1]} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="cumulative" name="Cumulative" stroke={COLORS[0]} strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="stat-card print:shadow-none">
          <StatementHeader title="Statement of Cash Flows" subtitle="Direct Method" />
          {sortedMonths.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No cash transactions found for this period. Post journal entries affecting Cash/Bank accounts.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>Category</th><th className="text-right w-40">Amount</th></tr></thead>
              <tbody>
                <tr><td colSpan={2} className="font-semibold text-foreground bg-muted/40 py-2">Cash Flows from Operating Activities</td></tr>
                {sortedMonths.map((d, i) => d.operating !== 0 && (
                  <tr key={`o-${i}`}><td className="pl-8 text-foreground">{d.month}</td><td className="text-right font-mono">{fmt(d.operating)}</td></tr>
                ))}
                <tr className="font-semibold border-t"><td className="pl-4">Net Cash from Operations</td><td className="text-right font-mono">{fmt(totalOperating)}</td></tr>

                <tr><td colSpan={2} className="font-semibold text-foreground bg-muted/40 py-2">Cash Flows from Investing Activities</td></tr>
                {sortedMonths.map((d, i) => d.investing !== 0 && (
                  <tr key={`i-${i}`}><td className="pl-8 text-foreground">{d.month}</td><td className="text-right font-mono">{fmt(d.investing)}</td></tr>
                ))}
                <tr className="font-semibold border-t"><td className="pl-4">Net Cash from Investing</td><td className="text-right font-mono">{fmt(totalInvesting)}</td></tr>

                <tr><td colSpan={2} className="font-semibold text-foreground bg-muted/40 py-2">Cash Flows from Financing Activities</td></tr>
                {sortedMonths.map((d, i) => d.financing !== 0 && (
                  <tr key={`f-${i}`}><td className="pl-8 text-foreground">{d.month}</td><td className="text-right font-mono">{fmt(d.financing)}</td></tr>
                ))}
                <tr className="font-semibold border-t"><td className="pl-4">Net Cash from Financing</td><td className="text-right font-mono">{fmt(totalFinancing)}</td></tr>

                <tr className="font-bold border-t-2 border-foreground/30 bg-primary/5">
                  <td>Net Change in Cash</td>
                  <td className={`text-right font-mono ${netChange >= 0 ? "text-success" : "text-destructive"}`}>{fmt(netChange)}</td>
                </tr>
                <tr><td className="text-foreground">Beginning Cash Balance</td><td className="text-right font-mono">{fmt(beginningCash)}</td></tr>
                <tr className="font-bold border-t-2"><td>Ending Cash Balance</td><td className="text-right font-mono">{fmt(endingCash)}</td></tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  const renderExpenseSummary = () => {
    const categorySummary = new Map<string, number>();
    const filteredExpenses = expenses?.filter(e => e.expense_date >= periodFrom && e.expense_date <= periodTo) || [];
    filteredExpenses.forEach(e => {
      const cat = (e.expense_categories as any)?.name || "Uncategorized";
      categorySummary.set(cat, (categorySummary.get(cat) || 0) + Number(e.amount));
    });
    const chartData = Array.from(categorySummary.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
    const total = filteredExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const approved = filteredExpenses.filter(e => e.status === "approved").reduce((s, e) => s + Number(e.amount), 0);
    const pending = filteredExpenses.filter(e => e.status === "pending").reduce((s, e) => s + Number(e.amount), 0);
    const rejected = filteredExpenses.filter(e => e.status === "rejected").reduce((s, e) => s + Number(e.amount), 0);

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Total</p><p className="text-xl font-bold text-foreground mt-1">{fmt(total)}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Approved</p><p className="text-xl font-bold text-success mt-1">{fmt(approved)}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Pending</p><p className="text-xl font-bold text-warning mt-1">{fmt(pending)}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Rejected</p><p className="text-xl font-bold text-destructive mt-1">{fmt(rejected)}</p></div>
        </div>
        {chartData.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="stat-card">
              <h3 className="text-sm font-medium text-foreground mb-4">By Category</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `LKR ${v.toLocaleString()}`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={120} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                    {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="stat-card">
              <h3 className="text-sm font-medium text-foreground mb-4">Distribution</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={chartData} cx="50%" cy="50%" outerRadius={100} innerRadius={50} dataKey="amount" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="stat-card"><p className="text-center py-12 text-muted-foreground">No expenses found for this period.</p></div>
        )}
      </div>
    );
  };

  const renderAgedReceivables = () => {
    const now = new Date();
    const buckets = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };
    const outstanding = invoices?.filter(i => i.status === "sent" || i.status === "overdue") || [];
    const customerBuckets = new Map<string, typeof buckets>();

    outstanding.forEach(inv => {
      const due = inv.due_date ? new Date(inv.due_date) : new Date(inv.issue_date);
      const daysOverdue = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
      const amt = Number(inv.total_amount);
      const custName = (inv.customers as any)?.name || "Unknown";
      
      if (!customerBuckets.has(custName)) customerBuckets.set(custName, { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 });
      const cb = customerBuckets.get(custName)!;
      
      if (daysOverdue <= 0) { buckets.current += amt; cb.current += amt; }
      else if (daysOverdue <= 30) { buckets.days30 += amt; cb.days30 += amt; }
      else if (daysOverdue <= 60) { buckets.days60 += amt; cb.days60 += amt; }
      else if (daysOverdue <= 90) { buckets.days90 += amt; cb.days90 += amt; }
      else { buckets.over90 += amt; cb.over90 += amt; }
    });

    const chartData = [
      { name: "Current", amount: buckets.current },
      { name: "1-30 days", amount: buckets.days30 },
      { name: "31-60 days", amount: buckets.days60 },
      { name: "61-90 days", amount: buckets.days90 },
      { name: "90+ days", amount: buckets.over90 },
    ];
    const total = Object.values(buckets).reduce((s, v) => s + v, 0);

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {chartData.map((d, i) => (
            <div key={i} className="stat-card">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{d.name}</p>
              <p className="text-lg font-bold text-foreground mt-1">{fmt(d.amount)}</p>
              <p className="text-xs text-muted-foreground">{total > 0 ? ((d.amount / total) * 100).toFixed(1) : 0}%</p>
            </div>
          ))}
        </div>

        {total > 0 && (
          <div className="stat-card">
            <h3 className="text-sm font-medium text-foreground mb-4">Aging Distribution</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `LKR ${v.toLocaleString()}`} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="stat-card print:shadow-none">
          <StatementHeader title="Aged Receivables Report" />
          {total === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No outstanding invoices. All invoices have been paid.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="text-right">Current</th>
                  <th className="text-right">1-30</th>
                  <th className="text-right">31-60</th>
                  <th className="text-right">61-90</th>
                  <th className="text-right">90+</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(customerBuckets.entries()).map(([name, cb]) => {
                  const custTotal = cb.current + cb.days30 + cb.days60 + cb.days90 + cb.over90;
                  return (
                    <tr key={name}>
                      <td className="font-medium text-foreground">{name}</td>
                      <td className="text-right font-mono">{cb.current > 0 ? fmt(cb.current) : "-"}</td>
                      <td className="text-right font-mono">{cb.days30 > 0 ? fmt(cb.days30) : "-"}</td>
                      <td className="text-right font-mono">{cb.days60 > 0 ? fmt(cb.days60) : "-"}</td>
                      <td className="text-right font-mono">{cb.days90 > 0 ? fmt(cb.days90) : "-"}</td>
                      <td className="text-right font-mono">{cb.over90 > 0 ? fmt(cb.over90) : "-"}</td>
                      <td className="text-right font-mono font-semibold">{fmt(custTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2">
                  <td>Total</td>
                  <td className="text-right font-mono">{fmt(buckets.current)}</td>
                  <td className="text-right font-mono">{fmt(buckets.days30)}</td>
                  <td className="text-right font-mono">{fmt(buckets.days60)}</td>
                  <td className="text-right font-mono">{fmt(buckets.days90)}</td>
                  <td className="text-right font-mono">{fmt(buckets.over90)}</td>
                  <td className="text-right font-mono">{fmt(total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    );
  };

  const renderFixedAssetSchedule = () => {
    const rows = assetScheduleData ?? [];
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const totalAccumDep = rows.reduce((s, r) => s + r.accumulated_depreciation, 0);
    const totalDepInPeriod = rows.reduce((s, r) => s + r.depreciation_in_period, 0);
    const totalNBV = rows.reduce((s, r) => s + r.net_book_value, 0);

    const grouped = new Map<string, typeof rows>();
    rows.forEach(r => {
      if (!grouped.has(r.category)) grouped.set(r.category, []);
      grouped.get(r.category)!.push(r);
    });

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Cost", value: totalCost, cls: "text-foreground" },
            { label: "Accum. Depreciation", value: totalAccumDep, cls: "text-destructive" },
            { label: "Period Charge", value: totalDepInPeriod, cls: "text-muted-foreground" },
            { label: "Net Book Value", value: totalNBV, cls: "text-primary" },
          ].map(({ label, value, cls }) => (
            <div key={label} className="stat-card">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className={`text-xl font-bold mt-1 ${cls}`}>{fmt(value)}</p>
            </div>
          ))}
        </div>

        <div className="stat-card print:shadow-none">
          <StatementHeader title="Fixed Asset Schedule" subtitle="Property, Plant & Equipment" />

          {rows.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">
              No assets found. Add assets and run depreciation to populate this report.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Asset Name</th>
                  <th>Category</th>
                  <th className="text-right w-28">Acq. Date</th>
                  <th className="text-right w-32">Cost</th>
                  <th className="text-right w-36">Accum. Depr.</th>
                  <th className="text-right w-32">Period Charge</th>
                  <th className="text-right w-32">Net Book Value</th>
                  <th className="w-24">% Depr.</th>
                  <th className="w-24">Status</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(grouped.entries()).map(([category, assets]) => {
                  const catCost = assets.reduce((s, a) => s + a.cost, 0);
                  const catAccum = assets.reduce((s, a) => s + a.accumulated_depreciation, 0);
                  const catPeriod = assets.reduce((s, a) => s + a.depreciation_in_period, 0);
                  const catNBV = assets.reduce((s, a) => s + a.net_book_value, 0);
                  return (
                    <>
                      <tr key={`cat-${category}`} className="bg-muted/40">
                        <td colSpan={9} className="font-semibold text-foreground pl-2 py-1.5 text-sm">
                          {category}
                        </td>
                      </tr>
                      {assets.map(asset => (
                        <tr key={asset.id}>
                          <td className="pl-6 font-medium text-foreground">{asset.asset_name}</td>
                          <td className="text-muted-foreground text-xs">{asset.category}</td>
                          <td className="text-right font-mono text-xs text-muted-foreground">
                            {asset.acquisition_date ? format(new Date(asset.acquisition_date), "dd MMM yyyy") : "—"}
                          </td>
                          <td className="text-right font-mono">{fmt(asset.cost)}</td>
                          <td className="text-right font-mono text-destructive/80">{fmt(asset.accumulated_depreciation)}</td>
                          <td className="text-right font-mono text-muted-foreground">
                            {asset.depreciation_in_period > 0 ? fmt(asset.depreciation_in_period) : "—"}
                          </td>
                          <td className="text-right font-mono font-semibold">{fmt(asset.net_book_value)}</td>
                          <td>
                            <div className="flex items-center gap-1 justify-end">
                              <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full"
                                  style={{ width: `${Math.min(asset.depreciation_pct, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground">{asset.depreciation_pct.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              asset.status === "active"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-muted text-muted-foreground"
                            }`}>
                              {asset.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                      <tr key={`subtotal-${category}`} className="border-t border-border/50 bg-muted/20">
                        <td colSpan={3} className="pl-6 text-sm text-muted-foreground italic">Subtotal — {category}</td>
                        <td className="text-right font-mono font-semibold">{fmt(catCost)}</td>
                        <td className="text-right font-mono font-semibold text-destructive/80">{fmt(catAccum)}</td>
                        <td className="text-right font-mono font-semibold text-muted-foreground">{fmt(catPeriod)}</td>
                        <td className="text-right font-mono font-semibold">{fmt(catNBV)}</td>
                        <td colSpan={2} />
                      </tr>
                    </>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2 border-foreground/30 bg-primary/5">
                  <td colSpan={3} className="text-foreground">Grand Total</td>
                  <td className="text-right font-mono">{fmt(totalCost)}</td>
                  <td className="text-right font-mono text-destructive">{fmt(totalAccumDep)}</td>
                  <td className="text-right font-mono text-muted-foreground">{fmt(totalDepInPeriod)}</td>
                  <td className="text-right font-mono">{fmt(totalNBV)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    );
  };

  const renderPpeSchedule = () => {
    const data = ppeScheduleData;
    if (!data) {
      return (
        <div className="stat-card print:shadow-none">
          <StatementHeader title="PPE Schedule" subtitle="Property, Plant & Equipment (IAS 16)" />
          <p className="text-center py-12 text-muted-foreground">Loading…</p>
        </div>
      );
    }
    const { blocks, fyLabels, rateMap, hasAssets, hasPosted, windowStartLabel, totals } = data;
    const colCount = 6 + fyLabels.length;
    const num = (v: number) => (v === 0 ? "-" : fmt(v));
    const rateOf = (id: string) => {
      const m = rateMap.get(id);
      return m && m > 0 ? `${((12 / m) * 100).toFixed(1)}%` : "-";
    };

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "Total Cost", value: totals.cost, cls: "text-foreground" },
            { label: "Accumulated Depreciation", value: totals.accumulated, cls: "text-destructive" },
            { label: "Net Book Value", value: totals.wdv, cls: "text-primary" },
          ].map(({ label, value, cls }) => (
            <div key={label} className="stat-card">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className={`text-xl font-bold mt-1 ${cls}`}>{fmt(value)}</p>
            </div>
          ))}
        </div>

        <div className="stat-card print:shadow-none">
          <StatementHeader title="PPE Schedule" subtitle="Property, Plant & Equipment (IAS 16)" />

          {!hasAssets ? (
            <p className="text-center py-12 text-muted-foreground">
              No assets found. Add assets and run depreciation to populate this schedule.
            </p>
          ) : (
            <>
              {!hasPosted && (
                <p className="text-xs text-muted-foreground italic text-center mb-3">
                  No posted depreciation in this period yet.
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-card text-left">Category / item</th>
                      <th className="text-left">Supplier</th>
                      <th className="text-right w-32">Cost</th>
                      <th className="text-right w-20">Dep. rate</th>
                      {fyLabels.map((l) => (
                        <th key={l} className="text-right w-28">{l}</th>
                      ))}
                      <th className="text-right w-36">Acc. depreciation</th>
                      <th className="text-right w-32">W D V</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blocks.map((block) => (
                      <Fragment key={block.category}>
                        <tr className="bg-secondary">
                          <td colSpan={colCount} className="sticky left-0 bg-secondary font-medium text-secondary-foreground py-1.5 px-2 text-sm">
                            {block.category}
                          </td>
                        </tr>

                        {block.openingRow && (
                          <tr className="italic text-muted-foreground">
                            <td className="sticky left-0 bg-card pl-6">
                              Opening value as at {windowStartLabel}
                              {block.openingRow.openingEstimated && (
                                <span
                                  title="Opening accumulated depreciation taken from asset record; no posted history before this period"
                                  className="ml-2 not-italic inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground"
                                >
                                  estimated
                                </span>
                              )}
                            </td>
                            <td className="bg-card">-</td>
                            <td className="text-right font-mono bg-card">{num(block.openingRow.cost)}</td>
                            <td className="text-right font-mono bg-card">-</td>
                            {block.openingRow.fyCharges.map((c, i) => (
                              <td key={i} className="text-right font-mono bg-card">{num(c)}</td>
                            ))}
                            <td className="text-right font-mono bg-card">{num(block.openingRow.accumulated)}</td>
                            <td className="text-right font-mono bg-card">{num(block.openingRow.wdv)}</td>
                          </tr>
                        )}

                        {block.rows.map((r) => (
                          <tr key={r.id}>
                            <td className="sticky left-0 bg-card pl-6 font-medium text-foreground">
                              {r.asset_name}
                              {r.disposed && (
                                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                                  Disposed{r.disposalDate ? ` (${r.disposalDate})` : ""}
                                </span>
                              )}
                            </td>
                            <td className="text-muted-foreground text-xs">{r.supplier ?? "-"}</td>
                            <td className="text-right font-mono">{num(r.cost)}</td>
                            <td className="text-right font-mono text-muted-foreground">{rateOf(r.id)}</td>
                            {r.fyCharges.map((c, i) => (
                              <td key={i} className="text-right font-mono text-muted-foreground">{num(c)}</td>
                            ))}
                            <td className="text-right font-mono text-destructive/80">{num(r.accumulated)}</td>
                            <td className={`text-right font-mono font-semibold ${r.disposed ? "text-muted-foreground line-through" : ""}`}>
                              {r.disposed ? "-" : num(r.wdv)}
                            </td>
                          </tr>
                        ))}

                        <tr className="font-bold bg-muted border-t border-border/50">
                          <td className="sticky left-0 bg-muted text-foreground pl-2">Total — {block.category}</td>
                          <td className="bg-muted" />
                          <td className="text-right font-mono">{num(block.totals.cost)}</td>
                          <td className="bg-muted" />
                          {block.totals.fyCharges.map((c, i) => (
                            <td key={i} className="text-right font-mono">{num(c)}</td>
                          ))}
                          <td className="text-right font-mono text-destructive">{num(block.totals.accumulated)}</td>
                          <td className="text-right font-mono">{num(block.totals.wdv)}</td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold border-t-2 border-foreground/30 bg-muted">
                      <td className="sticky left-0 bg-muted text-foreground">Grand total</td>
                      <td className="bg-muted" />
                      <td className="text-right font-mono">{num(totals.cost)}</td>
                      <td className="bg-muted" />
                      {totals.fyCharges.map((c, i) => (
                        <td key={i} className="text-right font-mono">{num(c)}</td>
                      ))}
                      <td className="text-right font-mono text-destructive">{num(totals.accumulated)}</td>
                      <td className="text-right font-mono">{num(totals.wdv)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderReport = () => {
    switch (activeReport) {
      case "trial-balance": return renderTrialBalance();
      case "pnl": return renderPnL();
      case "balance-sheet": return renderBalanceSheet();
      case "cash-flow": return renderCashFlow();
      case "expense-summary": return renderExpenseSummary();
      case "aged-receivables": return renderAgedReceivables();
      case "fixed-asset-schedule": return renderFixedAssetSchedule();
      case "ppe-schedule": return renderPpeSchedule();
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Financial Reports</h1>
          <p className="page-description">Generate and analyze financial statements and management reports</p>
        </div>
        <div className="flex items-center gap-2">
          {activeReport && (
            <>
              <Button variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
                <Printer className="w-4 h-4 mr-1" /> Print
              </Button>
              <Button variant="outline" size="sm" onClick={() => setActiveReport(null)} className="print:hidden">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-3 print:hidden">
        <label className="text-sm text-muted-foreground">Period:</label>
        <input type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} className="text-sm border rounded-md px-3 py-1.5 bg-card text-foreground" />
        <span className="text-muted-foreground">to</span>
        <input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} className="text-sm border rounded-md px-3 py-1.5 bg-card text-foreground" />
      </div>

      {!activeReport ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map((report) => (
            <div
              key={report.id}
              className="stat-card flex flex-col gap-3 cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all group"
              onClick={() => setActiveReport(report.id)}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <report.icon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{report.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{report.description}</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                  {report.category}
                </span>
                <Button variant="ghost" size="sm" className="text-xs">Generate →</Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        renderReport()
      )}
    </div>
  );
}
