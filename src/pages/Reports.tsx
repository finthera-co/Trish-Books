import { useState } from "react";
import { FileText, TrendingUp, DollarSign, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccounts, useJournalEntries, useInvoices, useExpenses, useBudgets } from "@/hooks/useData";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

type ReportType = "trial-balance" | "pnl" | "balance-sheet" | "cash-flow" | "expense-summary" | "aged-receivables" | null;

const COLORS = ["hsl(215, 60%, 42%)", "hsl(142, 71%, 35%)", "hsl(38, 92%, 50%)", "hsl(199, 89%, 48%)", "hsl(0, 72%, 51%)"];

export default function Reports() {
  const [activeReport, setActiveReport] = useState<ReportType>(null);
  const { data: accounts } = useAccounts();
  const { data: journalEntries } = useJournalEntries();
  const { data: invoices } = useInvoices();
  const { data: expenses } = useExpenses();
  const { data: budgets } = useBudgets();

  // Build account balances from journal lines
  const accountBalances = new Map<string, { name: string; code: string; type: string; debit: number; credit: number }>();
  accounts?.forEach(a => accountBalances.set(a.id, { name: a.account_name, code: a.account_code, type: a.account_type, debit: 0, credit: 0 }));
  journalEntries?.forEach(entry => {
    ((entry.journal_lines as any[]) || []).forEach(line => {
      const acc = accountBalances.get(line.account_id);
      if (acc) {
        acc.debit += Number(line.debit) || 0;
        acc.credit += Number(line.credit) || 0;
      }
    });
  });

  const balances = Array.from(accountBalances.values()).filter(a => a.debit > 0 || a.credit > 0);

  const reports = [
    { id: "trial-balance" as ReportType, name: "Trial Balance", description: "Verify total debits equal total credits", icon: FileText, category: "Accounting" },
    { id: "pnl" as ReportType, name: "Profit & Loss", description: "Revenue, expenses, and net profit for the period", icon: TrendingUp, category: "Financial" },
    { id: "balance-sheet" as ReportType, name: "Balance Sheet", description: "Assets, liabilities, and equity snapshot", icon: DollarSign, category: "Financial" },
    { id: "expense-summary" as ReportType, name: "Expense Summary", description: "Expense breakdown by category and status", icon: BarChart3, category: "Operations" },
    { id: "aged-receivables" as ReportType, name: "Aged Receivables", description: "Outstanding customer invoices by age", icon: FileText, category: "Billing" },
  ];

  const renderTrialBalance = () => {
    const totalDebit = balances.reduce((s, a) => s + a.debit, 0);
    const totalCredit = balances.reduce((s, a) => s + a.credit, 0);
    return (
      <div className="stat-card">
        <h3 className="text-sm font-medium text-foreground mb-4">Trial Balance</h3>
        {balances.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No journal entries found. Post journal entries to generate the trial balance.</p>
        ) : (
          <>
            <table className="data-table">
              <thead><tr><th>Code</th><th>Account</th><th>Type</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
              <tbody>
                {balances.sort((a, b) => a.code.localeCompare(b.code)).map((a, i) => (
                  <tr key={i}>
                    <td className="font-mono text-xs text-muted-foreground">{a.code}</td>
                    <td className="font-medium text-foreground">{a.name}</td>
                    <td><span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">{a.type}</span></td>
                    <td className="text-right">${a.debit.toLocaleString()}</td>
                    <td className="text-right">${a.credit.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td colSpan={3} className="text-foreground">Total</td>
                  <td className="text-right text-foreground">${totalDebit.toLocaleString()}</td>
                  <td className="text-right text-foreground">${totalCredit.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
            <p className={`mt-4 text-sm font-medium ${totalDebit === totalCredit ? "text-success" : "text-destructive"}`}>
              {totalDebit === totalCredit ? "✓ Trial balance is balanced" : `✗ Difference: $${Math.abs(totalDebit - totalCredit).toLocaleString()}`}
            </p>
          </>
        )}
      </div>
    );
  };

  const renderPnL = () => {
    const revenue = balances.filter(a => a.type === "Revenue");
    const expenseAccounts = balances.filter(a => a.type === "Expense");
    const totalRevenue = revenue.reduce((s, a) => s + (a.credit - a.debit), 0);
    const totalExpense = expenseAccounts.reduce((s, a) => s + (a.debit - a.credit), 0);
    const netIncome = totalRevenue - totalExpense;

    const chartData = [
      ...revenue.map(a => ({ name: a.name, amount: a.credit - a.debit, type: "Revenue" })),
      ...expenseAccounts.map(a => ({ name: a.name, amount: a.debit - a.credit, type: "Expense" })),
    ];

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="stat-card"><p className="text-sm text-muted-foreground">Total Revenue</p><p className="text-xl font-semibold text-success mt-1">${totalRevenue.toLocaleString()}</p></div>
          <div className="stat-card"><p className="text-sm text-muted-foreground">Total Expenses</p><p className="text-xl font-semibold text-destructive mt-1">${totalExpense.toLocaleString()}</p></div>
          <div className="stat-card"><p className="text-sm text-muted-foreground">Net Income</p><p className={`text-xl font-semibold mt-1 ${netIncome >= 0 ? "text-success" : "text-destructive"}`}>${netIncome.toLocaleString()}</p></div>
        </div>
        {chartData.length > 0 && (
          <div className="stat-card">
            <h3 className="text-sm font-medium text-foreground mb-4">Revenue vs Expenses</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 20%, 90%)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(215, 14%, 46%)" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(215, 14%, 46%)" />
                <Tooltip />
                <Bar dataKey="amount" fill="hsl(215, 60%, 42%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Profit & Loss Statement</h3>
          {revenue.length === 0 && expenseAccounts.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No revenue or expense entries found.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>Account</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {revenue.length > 0 && <tr><td colSpan={2} className="font-semibold text-foreground bg-muted/30">Revenue</td></tr>}
                {revenue.map((a, i) => <tr key={`r-${i}`}><td className="pl-8">{a.name}</td><td className="text-right text-success">${(a.credit - a.debit).toLocaleString()}</td></tr>)}
                {revenue.length > 0 && <tr className="font-medium"><td className="pl-4">Total Revenue</td><td className="text-right text-success">${totalRevenue.toLocaleString()}</td></tr>}
                {expenseAccounts.length > 0 && <tr><td colSpan={2} className="font-semibold text-foreground bg-muted/30">Expenses</td></tr>}
                {expenseAccounts.map((a, i) => <tr key={`e-${i}`}><td className="pl-8">{a.name}</td><td className="text-right text-destructive">${(a.debit - a.credit).toLocaleString()}</td></tr>)}
                {expenseAccounts.length > 0 && <tr className="font-medium"><td className="pl-4">Total Expenses</td><td className="text-right text-destructive">${totalExpense.toLocaleString()}</td></tr>}
                <tr className="font-bold text-lg"><td>Net Income</td><td className={`text-right ${netIncome >= 0 ? "text-success" : "text-destructive"}`}>${netIncome.toLocaleString()}</td></tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  const renderBalanceSheet = () => {
    const assets = balances.filter(a => a.type === "Asset");
    const liabilities = balances.filter(a => a.type === "Liability");
    const equity = balances.filter(a => a.type === "Equity");
    const totalAssets = assets.reduce((s, a) => s + (a.debit - a.credit), 0);
    const totalLiabilities = liabilities.reduce((s, a) => s + (a.credit - a.debit), 0);
    const totalEquity = equity.reduce((s, a) => s + (a.credit - a.debit), 0);

    const pieData = [
      { name: "Assets", value: Math.abs(totalAssets) },
      { name: "Liabilities", value: Math.abs(totalLiabilities) },
      { name: "Equity", value: Math.abs(totalEquity) },
    ].filter(d => d.value > 0);

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="stat-card"><p className="text-sm text-muted-foreground">Total Assets</p><p className="text-xl font-semibold text-foreground mt-1">${totalAssets.toLocaleString()}</p></div>
          <div className="stat-card"><p className="text-sm text-muted-foreground">Total Liabilities</p><p className="text-xl font-semibold text-warning mt-1">${totalLiabilities.toLocaleString()}</p></div>
          <div className="stat-card"><p className="text-sm text-muted-foreground">Total Equity</p><p className="text-xl font-semibold text-primary mt-1">${totalEquity.toLocaleString()}</p></div>
        </div>
        {pieData.length > 0 && (
          <div className="stat-card">
            <h3 className="text-sm font-medium text-foreground mb-4">Composition</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, value }) => `${name}: $${value.toLocaleString()}`}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Balance Sheet</h3>
          {assets.length === 0 && liabilities.length === 0 && equity.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No balance sheet data. Create accounts and post journal entries.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>Account</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                {assets.length > 0 && <tr><td colSpan={2} className="font-semibold text-foreground bg-muted/30">Assets</td></tr>}
                {assets.map((a, i) => <tr key={`a-${i}`}><td className="pl-8">{a.name}</td><td className="text-right">${(a.debit - a.credit).toLocaleString()}</td></tr>)}
                {assets.length > 0 && <tr className="font-medium"><td className="pl-4">Total Assets</td><td className="text-right">${totalAssets.toLocaleString()}</td></tr>}
                {liabilities.length > 0 && <tr><td colSpan={2} className="font-semibold text-foreground bg-muted/30">Liabilities</td></tr>}
                {liabilities.map((a, i) => <tr key={`l-${i}`}><td className="pl-8">{a.name}</td><td className="text-right">${(a.credit - a.debit).toLocaleString()}</td></tr>)}
                {liabilities.length > 0 && <tr className="font-medium"><td className="pl-4">Total Liabilities</td><td className="text-right">${totalLiabilities.toLocaleString()}</td></tr>}
                {equity.length > 0 && <tr><td colSpan={2} className="font-semibold text-foreground bg-muted/30">Equity</td></tr>}
                {equity.map((a, i) => <tr key={`eq-${i}`}><td className="pl-8">{a.name}</td><td className="text-right">${(a.credit - a.debit).toLocaleString()}</td></tr>)}
                {equity.length > 0 && <tr className="font-medium"><td className="pl-4">Total Equity</td><td className="text-right">${totalEquity.toLocaleString()}</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  const renderExpenseSummary = () => {
    const categorySummary = new Map<string, number>();
    expenses?.forEach(e => {
      const cat = (e.expense_categories as any)?.name || "Uncategorized";
      categorySummary.set(cat, (categorySummary.get(cat) || 0) + Number(e.amount));
    });
    const chartData = Array.from(categorySummary.entries()).map(([name, amount]) => ({ name, amount }));
    const total = expenses?.reduce((s, e) => s + Number(e.amount), 0) || 0;
    const approved = expenses?.filter(e => e.status === "approved").reduce((s, e) => s + Number(e.amount), 0) || 0;
    const pending = expenses?.filter(e => e.status === "pending").reduce((s, e) => s + Number(e.amount), 0) || 0;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="stat-card"><p className="text-sm text-muted-foreground">Total Expenses</p><p className="text-xl font-semibold text-foreground mt-1">${total.toLocaleString()}</p></div>
          <div className="stat-card"><p className="text-sm text-muted-foreground">Approved</p><p className="text-xl font-semibold text-success mt-1">${approved.toLocaleString()}</p></div>
          <div className="stat-card"><p className="text-sm text-muted-foreground">Pending</p><p className="text-xl font-semibold text-warning mt-1">${pending.toLocaleString()}</p></div>
        </div>
        {chartData.length > 0 && (
          <div className="stat-card">
            <h3 className="text-sm font-medium text-foreground mb-4">Expenses by Category</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 20%, 90%)" />
                <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(215, 14%, 46%)" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(215, 14%, 46%)" width={120} />
                <Tooltip />
                <Bar dataKey="amount" fill="hsl(0, 72%, 51%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  };

  const renderAgedReceivables = () => {
    const now = new Date();
    const buckets = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };
    const outstanding = invoices?.filter(i => i.status === "sent" || i.status === "overdue") || [];
    outstanding.forEach(inv => {
      const due = inv.due_date ? new Date(inv.due_date) : new Date(inv.issue_date);
      const daysOverdue = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
      const amt = Number(inv.total_amount);
      if (daysOverdue <= 0) buckets.current += amt;
      else if (daysOverdue <= 30) buckets.days30 += amt;
      else if (daysOverdue <= 60) buckets.days60 += amt;
      else if (daysOverdue <= 90) buckets.days90 += amt;
      else buckets.over90 += amt;
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
        <div className="stat-card">
          <p className="text-sm text-muted-foreground">Total Outstanding</p>
          <p className="text-2xl font-semibold text-foreground mt-1">${total.toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Aged Receivables</h3>
          {total === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No outstanding invoices</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 20%, 90%)" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(215, 14%, 46%)" />
                  <YAxis tick={{ fontSize: 12 }} stroke="hsl(215, 14%, 46%)" />
                  <Tooltip />
                  <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                    {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <table className="data-table mt-4">
                <thead><tr><th>Aging Bucket</th><th className="text-right">Amount</th><th className="text-right">% of Total</th></tr></thead>
                <tbody>
                  {chartData.map((d, i) => (
                    <tr key={i}>
                      <td className="font-medium text-foreground">{d.name}</td>
                      <td className="text-right">${d.amount.toLocaleString()}</td>
                      <td className="text-right text-muted-foreground">{total > 0 ? ((d.amount / total) * 100).toFixed(1) : 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
      case "expense-summary": return renderExpenseSummary();
      case "aged-receivables": return renderAgedReceivables();
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Financial Reports</h1>
          <p className="page-description">Generate and view financial statements</p>
        </div>
        {activeReport && (
          <Button variant="outline" onClick={() => setActiveReport(null)}>← Back to Reports</Button>
        )}
      </div>

      {!activeReport ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {reports.map((report) => (
            <div key={report.id} className="stat-card flex items-start gap-4 cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onClick={() => setActiveReport(report.id)}>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <report.icon className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-foreground">{report.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{report.description}</p>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground mt-2">
                  {report.category}
                </span>
              </div>
              <Button variant="outline" size="sm">View</Button>
            </div>
          ))}
        </div>
      ) : (
        renderReport()
      )}
    </div>
  );
}
