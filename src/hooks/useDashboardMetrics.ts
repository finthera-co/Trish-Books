import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, eachMonthOfInterval, startOfMonth, endOfMonth } from "date-fns";

interface PeriodFilter {
  from: string;
  to: string;
}

export interface DashboardMetrics {
  // Revenue/Expense totals
  totalRevenue: number;
  totalCOGS: number;
  totalExpenses: number;
  operatingExpenses: number;
  grossProfit: number;
  grossProfitMargin: number;
  operatingProfit: number;
  operatingMargin: number;
  netProfit: number;
  netProfitMargin: number;
  // Balance sheet
  totalAssets: number;
  currentAssets: number;
  currentLiabilities: number;
  totalLiabilities: number;
  equity: number;
  cash: number;
  inventory: number;
  accountsReceivable: number;
  accountsPayable: number;
  // Ratios
  currentRatio: number;
  quickRatio: number;
  cashRatio: number;
  workingCapital: number;
  roa: number;
  roe: number;
  assetTurnover: number;
  // AR/AP
  arTurnover: number;
  collectionPeriod: number;
  apTurnover: number;
  // Cash flow
  totalInflows: number;
  totalOutflows: number;
  // Monthly data
  monthlyData: { month: string; revenue: number; expenses: number; inflow: number; outflow: number }[];
  // Expense distribution
  expenseDistribution: { name: string; value: number }[];
  // Top customers
  topCustomers: { name: string; balance: number }[];
  // Previous period comparison
  prevRevenue: number;
  prevExpenses: number;
  revenueGrowth: number;
  // Budget
  budgetVariance: number;
  budgetVariancePct: number;
}

function useDashboardData(period: PeriodFilter) {
  const journalQuery = useQuery({
    queryKey: ["dashboard_journals", period.from, period.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("id, entry_date, status, voided_at, reversal_of, journal_lines(account_id, debit, credit)")
        .eq("status", "posted")
        .is("voided_at", null)
        .gte("entry_date", period.from)
        .lte("entry_date", period.to);
      if (error) throw error;
      return data;
    },
  });

  const accountsQuery = useQuery({
    queryKey: ["dashboard_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, account_name, account_type, account_subtype, account_code, category_id, account_categories(name)");
      if (error) throw error;
      return data;
    },
  });

  const invoicesQuery = useQuery({
    queryKey: ["dashboard_invoices", period.from, period.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, total_amount, status, customer_id, customers(name), payments_received(amount)")
        .gte("issue_date", period.from)
        .lte("issue_date", period.to);
      if (error) throw error;
      return data;
    },
  });

  const expensesQuery = useQuery({
    queryKey: ["dashboard_expenses", period.from, period.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("id, amount, category_id, expense_categories(name)")
        .gte("expense_date", period.from)
        .lte("expense_date", period.to);
      if (error) throw error;
      return data;
    },
  });

  const budgetsQuery = useQuery({
    queryKey: ["dashboard_budgets", period.from, period.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("budgets")
        .select("total_budget")
        .gte("period_start", period.from)
        .lte("period_end", period.to);
      if (error) throw error;
      return data;
    },
  });

  return {
    journals: journalQuery.data || [],
    accounts: accountsQuery.data || [],
    invoices: invoicesQuery.data || [],
    expenses: expensesQuery.data || [],
    budgets: budgetsQuery.data || [],
    isLoading: journalQuery.isLoading || accountsQuery.isLoading || invoicesQuery.isLoading,
  };
}

export function useDashboardMetrics(period: PeriodFilter) {
  const { journals, accounts, invoices, expenses, budgets, isLoading } = useDashboardData(period);

  const metrics = useMemo<DashboardMetrics>(() => {
    // Build account lookup maps
    const accountMap = new Map(accounts.map(a => [a.id, a]));
    const byType = (type: string) => new Set(accounts.filter(a => a.account_type === type).map(a => a.id));

    const revenueIds = byType("Revenue");
    const cogsIds = new Set(accounts.filter(a => a.account_type === "COGS").map(a => a.id));
    const expenseIds = byType("Expense");
    const assetIds = byType("Asset");
    const liabilityIds = byType("Liability");
    const equityIds = byType("Equity");

    // Categorize accounts by subtype/category
    const isCurrentAsset = (a: any) => {
      const cat = (a.account_categories as any)?.name?.toLowerCase() || "";
      const sub = a.account_subtype?.toLowerCase() || "";
      return cat.includes("current") || sub.includes("current") || sub.includes("receivable") || sub.includes("cash") || sub.includes("bank") || sub.includes("inventory");
    };
    const isCurrentLiability = (a: any) => {
      const cat = (a.account_categories as any)?.name?.toLowerCase() || "";
      const sub = a.account_subtype?.toLowerCase() || "";
      return cat.includes("current") || sub.includes("current") || sub.includes("payable");
    };
    const isCash = (a: any) => {
      const name = a.account_name?.toLowerCase() || "";
      const sub = a.account_subtype?.toLowerCase() || "";
      return name.includes("cash") || name.includes("bank") || sub.includes("cash");
    };
    const isInventory = (a: any) => {
      const name = a.account_name?.toLowerCase() || "";
      return name.includes("inventory") || name.includes("stock");
    };
    const isAR = (a: any) => {
      const name = a.account_name?.toLowerCase() || "";
      return name.includes("receivable");
    };
    const isAP = (a: any) => {
      const name = a.account_name?.toLowerCase() || "";
      return name.includes("payable");
    };

    // Calculate balances from journal lines
    const balances = new Map<string, number>();
    accounts.forEach(a => balances.set(a.id, 0));

    // Monthly buckets
    const monthBuckets: Record<string, { revenue: number; expenses: number; inflow: number; outflow: number }> = {};
    try {
      const months = eachMonthOfInterval({ start: new Date(period.from), end: new Date(period.to) });
      months.forEach(m => {
        monthBuckets[format(m, "yyyy-MM")] = { revenue: 0, expenses: 0, inflow: 0, outflow: 0 };
      });
    } catch { /* invalid range */ }

    journals.forEach(entry => {
      const month = entry.entry_date?.slice(0, 7);
      const lines = (entry.journal_lines as any[]) || [];
      lines.forEach(line => {
        const acct = accountMap.get(line.account_id);
        if (!acct) return;
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;
        const isDebitNormal = ["Asset", "Expense", "COGS"].includes(acct.account_type);
        const bal = isDebitNormal ? debit - credit : credit - debit;
        balances.set(line.account_id, (balances.get(line.account_id) || 0) + bal);

        if (month && monthBuckets[month]) {
          if (revenueIds.has(line.account_id)) {
            monthBuckets[month].revenue += credit - debit;
          }
          if (expenseIds.has(line.account_id) || cogsIds.has(line.account_id)) {
            monthBuckets[month].expenses += debit - credit;
          }
          // Cash flow: debit to asset = inflow, credit to asset = outflow
          if (isCash(acct)) {
            if (debit > 0) monthBuckets[month].inflow += debit;
            if (credit > 0) monthBuckets[month].outflow += credit;
          }
        }
      });
    });

    // Aggregate by type
    let totalRevenue = 0, totalCOGS = 0, totalExpenses = 0;
    let totalAssets = 0, currentAssets = 0, totalLiabilities = 0, currentLiabilities = 0, equity = 0;
    let cash = 0, inventory = 0, accountsReceivable = 0, accountsPayable = 0;

    accounts.forEach(a => {
      const bal = balances.get(a.id) || 0;
      if (revenueIds.has(a.id)) totalRevenue += bal;
      if (cogsIds.has(a.id)) totalCOGS += bal;
      if (expenseIds.has(a.id)) totalExpenses += bal;
      if (assetIds.has(a.id)) {
        totalAssets += bal;
        if (isCurrentAsset(a)) currentAssets += bal;
        if (isCash(a)) cash += bal;
        if (isInventory(a)) inventory += bal;
        if (isAR(a)) accountsReceivable += bal;
      }
      if (liabilityIds.has(a.id)) {
        totalLiabilities += bal;
        if (isCurrentLiability(a)) currentLiabilities += bal;
        if (isAP(a)) accountsPayable += bal;
      }
      if (equityIds.has(a.id)) equity += bal;
    });

    const grossProfit = totalRevenue - totalCOGS;
    const operatingExpenses = totalExpenses;
    const operatingProfit = grossProfit - operatingExpenses;
    const netProfit = totalRevenue - totalCOGS - totalExpenses;

    const safe = (n: number, d: number) => d !== 0 ? n / d : 0;

    // Expense distribution from expense records
    const expDist: Record<string, number> = {};
    expenses.forEach(e => {
      const cat = (e.expense_categories as any)?.name || "Uncategorized";
      expDist[cat] = (expDist[cat] || 0) + Number(e.amount);
    });

    // Top customers by invoice balance
    const custBalances: Record<string, { name: string; balance: number }> = {};
    invoices?.forEach(inv => {
      const paid = ((inv.payments_received as any[]) || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
      const balance = Number(inv.total_amount) - paid;
      const name = (inv.customers as any)?.name || "Unknown";
      if (!custBalances[name]) custBalances[name] = { name, balance: 0 };
      custBalances[name].balance += balance;
    });

    // Monthly data
    const monthlyData = Object.entries(monthBuckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month: format(new Date(month + "-01"), "MMM yy"),
        ...data,
      }));

    const totalInflows = monthlyData.reduce((s, m) => s + m.inflow, 0);
    const totalOutflows = monthlyData.reduce((s, m) => s + m.outflow, 0);

    // Budget variance
    const totalBudget = budgets.reduce((s, b) => s + Number(b.total_budget), 0);
    const actualSpend = totalCOGS + totalExpenses;
    const budgetVariance = actualSpend - totalBudget;
    const budgetVariancePct = safe(budgetVariance, totalBudget) * 100;

    return {
      totalRevenue,
      totalCOGS,
      totalExpenses,
      operatingExpenses,
      grossProfit,
      grossProfitMargin: safe(grossProfit, totalRevenue) * 100,
      operatingProfit,
      operatingMargin: safe(operatingProfit, totalRevenue) * 100,
      netProfit,
      netProfitMargin: safe(netProfit, totalRevenue) * 100,
      totalAssets,
      currentAssets,
      currentLiabilities,
      totalLiabilities,
      equity,
      cash,
      inventory,
      accountsReceivable,
      accountsPayable,
      currentRatio: safe(currentAssets, currentLiabilities),
      quickRatio: safe(currentAssets - inventory, currentLiabilities),
      cashRatio: safe(cash, currentLiabilities),
      workingCapital: currentAssets - currentLiabilities,
      roa: safe(netProfit, totalAssets) * 100,
      roe: safe(netProfit, equity) * 100,
      assetTurnover: safe(totalRevenue, totalAssets),
      arTurnover: safe(totalRevenue, accountsReceivable),
      collectionPeriod: safe(365, safe(totalRevenue, accountsReceivable)),
      apTurnover: safe(totalCOGS, accountsPayable),
      totalInflows,
      totalOutflows,
      monthlyData,
      expenseDistribution: Object.values(expDist).length > 0
        ? Object.entries(expDist).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
        : [],
      topCustomers: Object.values(custBalances).sort((a, b) => b.balance - a.balance).slice(0, 5),
      prevRevenue: 0,
      prevExpenses: 0,
      revenueGrowth: 0,
      budgetVariance,
      budgetVariancePct,
    };
  }, [journals, accounts, invoices, expenses, budgets, period]);

  return { metrics, isLoading };
}
