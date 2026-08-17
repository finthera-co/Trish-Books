import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, eachMonthOfInterval, differenceInCalendarDays, subDays, parseISO } from "date-fns";
import { isDebitNormal } from "@/lib/accountTypes";

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
  // Per-account balances for every COA account whose detail type (subtype) is "Bank".
  bankAccounts: { id: string; name: string; code: string; balance: number }[];
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
  // AR/AP/Inventory — annualized, using average balances (audit-grade)
  arTurnover: number;
  collectionPeriod: number;
  apTurnover: number;
  inventoryTurnover: number;
  avgAccountsReceivable: number;
  avgAccountsPayable: number;
  avgInventory: number;
  // Cash flow
  totalInflows: number;
  totalOutflows: number;
  // Monthly data
  monthlyData: { month: string; revenue: number; expenses: number; inflow: number; outflow: number }[];
  // Expense distribution
  expenseDistribution: { name: string; value: number }[];
  // Top customers
  topCustomers: { name: string; balance: number }[];
  // Invoices summary (period-scoped by issue date)
  invoiceCount: number;
  overdueInvoiceCount: number;
  overdueAmount: number;
  currentMonthOverdueAmount: number;
  // Previous period comparison
  prevRevenue: number;
  prevExpenses: number;
  revenueGrowth: number;
  expenseGrowth: number;
  // Workforce / runway
  headcount: number;
  profitPerEmployee: number;
  avgMonthlyBurn: number;
  cashRunwayMonths: number;
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
        .select("id, account_name, account_type, account_subtype, account_code, parent_account_id, category_id, account_categories(name)");
      if (error) throw error;
      return data;
    },
  });

  const invoicesQuery = useQuery({
    queryKey: ["dashboard_invoices", period.from, period.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, total_amount, due_date, status, customer_id, customers(name), payments_received(amount)")
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

  // Previous period of equal length, immediately preceding the selected range.
  const prevPeriod = (() => {
    try {
      const fromD = parseISO(period.from);
      const toD = parseISO(period.to);
      const len = differenceInCalendarDays(toD, fromD);
      const prevTo = subDays(fromD, 1);
      const prevFrom = subDays(prevTo, len);
      return { from: format(prevFrom, "yyyy-MM-dd"), to: format(prevTo, "yyyy-MM-dd") };
    } catch {
      return { from: period.from, to: period.to };
    }
  })();

  const prevJournalsQuery = useQuery({
    queryKey: ["dashboard_journals_prev", prevPeriod.from, prevPeriod.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("id, journal_lines(account_id, debit, credit)")
        .eq("status", "posted")
        .is("voided_at", null)
        .gte("entry_date", prevPeriod.from)
        .lte("entry_date", prevPeriod.to);
      if (error) throw error;
      return data;
    },
  });

  const employeesQuery = useQuery({
    queryKey: ["dashboard_employees_count"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("id, status");
      if (error) throw error;
      return data;
    },
  });

  // Opening balances: cumulative posted movement strictly BEFORE the period start.
  // Used to derive average balance-sheet balances for audit-grade turnover ratios.
  const openingJournalsQuery = useQuery({
    queryKey: ["dashboard_journals_opening", period.from],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("id, journal_lines(account_id, debit, credit)")
        .eq("status", "posted")
        .is("voided_at", null)
        .lt("entry_date", period.from);
      if (error) throw error;
      return data;
    },
  });

  // Every query feeds the same derived numbers, so a failure in any one of them
  // silently biases the whole dashboard toward zero. Surface it instead.
  const queries = [
    journalQuery, accountsQuery, invoicesQuery, expensesQuery,
    budgetsQuery, prevJournalsQuery, employeesQuery, openingJournalsQuery,
  ];
  const failed = queries.find((q) => q.isError);

  return {
    journals: journalQuery.data || [],
    prevJournals: prevJournalsQuery.data || [],
    openingJournals: openingJournalsQuery.data || [],
    accounts: accountsQuery.data || [],
    invoices: invoicesQuery.data || [],
    expenses: expensesQuery.data || [],
    budgets: budgetsQuery.data || [],
    employees: employeesQuery.data || [],
    isLoading: journalQuery.isLoading || accountsQuery.isLoading || invoicesQuery.isLoading,
    isError: !!failed,
    error: (failed?.error as Error) ?? null,
    isFetching: queries.some((q) => q.isFetching),
    refetch: () => { queries.forEach((q) => { void q.refetch(); }); },
  };
}

export function useDashboardMetrics(period: PeriodFilter) {
  const { journals, prevJournals, openingJournals, accounts, invoices, expenses, budgets, employees, isLoading, isError, error, isFetching, refetch } = useDashboardData(period);

  const metrics = useMemo<DashboardMetrics>(() => {
    // Build account lookup maps
    const accountMap = new Map(accounts.map(a => [a.id, a]));
    const byType = (type: string) => new Set(accounts.filter(a => a.account_type === type).map(a => a.id));

    // Use the canonical account-type taxonomy (see src/lib/accountTypes.ts).
    // Revenue = Income (+ Other Income); Expenses = Expense (+ Other Expense);
    // COGS = "Cost of Goods Sold". The old literals "Revenue"/"COGS" never matched
    // any account, which is why P&L charts read zero.
    const revenueIds = new Set(accounts.filter(a => a.account_type === "Income" || a.account_type === "Other Income").map(a => a.id));
    const cogsIds = new Set(accounts.filter(a => a.account_type === "Cost of Goods Sold").map(a => a.id));
    const expenseIds = new Set(accounts.filter(a => a.account_type === "Expense" || a.account_type === "Other Expense").map(a => a.id));
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
        const debitNormal = isDebitNormal(acct.account_type);
        const bal = debitNormal ? debit - credit : credit - debit;
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

    // ── Bank balances with sub-ledger roll-ups ────────────────────────────────
    // A bank account may be a non-postable parent ("Cash & Bank") whose real
    // balance lives in its child sub-ledgers. We roll up each bank account's own
    // balance plus the balance of every descendant in the parent_account_id tree,
    // so the KPI reflects the full bank position per tenant regardless of nesting.
    const isBankSubtype = (a: any) => (a?.account_subtype || "").trim().toLowerCase() === "bank";

    const childrenByParent = new Map<string, string[]>();
    accounts.forEach(a => {
      const pid = (a as any).parent_account_id;
      if (!pid) return;
      const arr = childrenByParent.get(pid) || [];
      arr.push(a.id);
      childrenByParent.set(pid, arr);
    });

    // Sum of an account's own balance + all of its descendants' balances.
    const rollupBalance = (id: string, seen = new Set<string>()): number => {
      if (seen.has(id)) return 0; // cycle guard
      seen.add(id);
      let total = balances.get(id) || 0;
      for (const childId of childrenByParent.get(id) || []) {
        total += rollupBalance(childId, seen);
      }
      return total;
    };

    // True when any ancestor is itself a Bank account — such accounts are folded
    // into their bank parent's roll-up, so we don't list them again (no double count).
    const hasBankAncestor = (a: any): boolean => {
      let pid = a?.parent_account_id;
      const guard = new Set<string>();
      while (pid && !guard.has(pid)) {
        guard.add(pid);
        const parent = accountMap.get(pid);
        if (!parent) break;
        if (isBankSubtype(parent)) return true;
        pid = (parent as any).parent_account_id;
      }
      return false;
    };

    const bankAccounts = accounts
      .filter(a => isBankSubtype(a) && !hasBankAncestor(a))
      .map(a => ({
        id: a.id,
        name: a.account_name,
        code: a.account_code,
        balance: rollupBalance(a.id),
      }))
      .sort((a, b) => (a.code || "").localeCompare(b.code || ""));

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

    // Top customers by invoice balance + invoice/overdue summary
    const todayIso = format(new Date(), "yyyy-MM-dd");
    const monthStartIso = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd");
    const custBalances: Record<string, { name: string; balance: number }> = {};
    let invoiceCount = 0;
    let overdueInvoiceCount = 0;
    let overdueAmount = 0;
    let currentMonthOverdueAmount = 0;
    invoices?.forEach(inv => {
      const paid = ((inv.payments_received as any[]) || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
      const owing = Number(inv.total_amount) - paid;
      const name = (inv.customers as any)?.name || "Unknown";
      if (!custBalances[name]) custBalances[name] = { name, balance: 0 };
      custBalances[name].balance += Number(inv.total_amount) - paid;

      invoiceCount += 1;
      // Overdue: posted (non-draft, non-voided), still owing, past its due date.
      const isOverdue =
        inv.status !== "draft" && inv.status !== "voided" &&
        owing > 0 && !!inv.due_date && inv.due_date < todayIso;
      if (isOverdue) {
        overdueInvoiceCount += 1;
        overdueAmount += owing;
        if (inv.due_date! >= monthStartIso) currentMonthOverdueAmount += owing;
      }
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

    // Previous-period revenue/expenses for growth comparison
    let prevRevenue = 0, prevExpenses = 0;
    prevJournals.forEach(entry => {
      const lines = (entry.journal_lines as any[]) || [];
      lines.forEach(line => {
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;
        if (revenueIds.has(line.account_id)) prevRevenue += credit - debit;
        if (expenseIds.has(line.account_id) || cogsIds.has(line.account_id)) prevExpenses += debit - credit;
      });
    });
    const revenueGrowth = safe(totalRevenue - prevRevenue, Math.abs(prevRevenue)) * 100;
    const expenseGrowth = safe((totalCOGS + totalExpenses) - prevExpenses, Math.abs(prevExpenses)) * 100;

    // Workforce + cash runway
    const headcount = employees.filter((e: any) => (e.status || "active") === "active").length;
    const profitPerEmployee = headcount > 0 ? netProfit / headcount : 0;
    const burnMonths = monthlyData.filter(m => m.inflow || m.outflow);
    const avgMonthlyBurn = burnMonths.length
      ? burnMonths.reduce((s, m) => s + (m.outflow - m.inflow), 0) / burnMonths.length
      : 0;
    const cashRunwayMonths = avgMonthlyBurn > 0 ? cash / avgMonthlyBurn : Infinity;

    // ── Audit-grade turnover ratios ──────────────────────────────────────────
    // Use AVERAGE balances [(opening + closing) / 2] and normalise for period
    // length so a non-annual range doesn't distort turnover / DSO / DPO / DIO.
    const arIds = new Set(accounts.filter(a => assetIds.has(a.id) && isAR(a)).map(a => a.id));
    const apIds = new Set(accounts.filter(a => liabilityIds.has(a.id) && isAP(a)).map(a => a.id));
    const invIds = new Set(accounts.filter(a => assetIds.has(a.id) && isInventory(a)).map(a => a.id));

    let openingAR = 0, openingAP = 0, openingInv = 0;
    openingJournals.forEach(entry => {
      const lines = (entry.journal_lines as any[]) || [];
      lines.forEach(line => {
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;
        if (arIds.has(line.account_id)) openingAR += debit - credit;   // asset, debit-normal
        if (invIds.has(line.account_id)) openingInv += debit - credit; // asset, debit-normal
        if (apIds.has(line.account_id)) openingAP += credit - debit;   // liability, credit-normal
      });
    });

    // accountsReceivable / accountsPayable / inventory above are the in-period
    // movement; closing = opening + movement.
    const closingAR = openingAR + accountsReceivable;
    const closingAP = openingAP + accountsPayable;
    const closingInv = openingInv + inventory;
    const avgAccountsReceivable = (openingAR + closingAR) / 2;
    const avgAccountsPayable = (openingAP + closingAP) / 2;
    const avgInventory = (openingInv + closingInv) / 2;

    const periodDays = Math.max(1, differenceInCalendarDays(parseISO(period.to), parseISO(period.from)) + 1);
    const annualFactor = 365 / periodDays;
    const arTurnover = safe(totalRevenue, avgAccountsReceivable) * annualFactor;
    const apTurnover = safe(totalCOGS, avgAccountsPayable) * annualFactor;
    const inventoryTurnover = safe(totalCOGS, avgInventory) * annualFactor;
    const collectionPeriod = arTurnover ? 365 / arTurnover : 0;

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
      bankAccounts,
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
      arTurnover,
      collectionPeriod,
      apTurnover,
      inventoryTurnover,
      avgAccountsReceivable,
      avgAccountsPayable,
      avgInventory,
      totalInflows,
      totalOutflows,
      monthlyData,
      expenseDistribution: Object.values(expDist).length > 0
        ? Object.entries(expDist).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
        : [],
      topCustomers: Object.values(custBalances).sort((a, b) => b.balance - a.balance).slice(0, 5),
      invoiceCount,
      overdueInvoiceCount,
      overdueAmount,
      currentMonthOverdueAmount,
      prevRevenue,
      prevExpenses,
      revenueGrowth,
      expenseGrowth,
      headcount,
      profitPerEmployee,
      avgMonthlyBurn,
      cashRunwayMonths,
      budgetVariance,
      budgetVariancePct,
    };
  }, [journals, prevJournals, openingJournals, accounts, invoices, expenses, budgets, employees, period]);

  return { metrics, isLoading, isError, error, isFetching, refetch };
}
