import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface Props {
  budgetId: string;
  startDate: string;
  endDate: string;
}

export default function BudgetTrendChart({ budgetId, startDate, endDate }: Props) {
  const { data: trendData, isLoading } = useQuery({
    queryKey: ["budget_trend", budgetId, startDate, endDate],
    queryFn: async () => {
      // Get budget items
      const { data: budget, error } = await supabase
        .from("budgets")
        .select("*, budget_items(account_id, allocated_amount)")
        .eq("id", budgetId)
        .single();
      if (error) throw error;

      const items = (budget.budget_items as any[]) || [];
      const accountIds = items.map((i: any) => i.account_id);
      if (accountIds.length === 0) return [];

      // Get all posted journal lines for these accounts in the period
      const { data: journalLines, error: jlError } = await supabase
        .from("journal_lines")
        .select("debit, credit, account_id, journal_entries!inner(entry_date, status)")
        .in("account_id", accountIds)
        .gte("journal_entries.entry_date", startDate)
        .lte("journal_entries.entry_date", endDate)
        .eq("journal_entries.status", "posted");
      if (jlError) throw jlError;

      // Group by month
      const monthlySpend: Record<string, number> = {};
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Initialize months
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor <= end) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
        monthlySpend[key] = 0;
        cursor.setMonth(cursor.getMonth() + 1);
      }

      // Sum spend per month
      (journalLines || []).forEach((jl: any) => {
        const entryDate = (jl.journal_entries as any)?.entry_date;
        if (!entryDate) return;
        const d = new Date(entryDate);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (monthlySpend[key] !== undefined) {
          monthlySpend[key] += Number(jl.debit) - Number(jl.credit);
        }
      });

      const totalAllocated = items.reduce((s: number, i: any) => s + Number(i.allocated_amount), 0);
      const months = Object.keys(monthlySpend).sort();
      const monthCount = months.length || 1;
      const monthlyBudget = totalAllocated / monthCount;

      let cumulative = 0;
      return months.map((month) => {
        cumulative += monthlySpend[month];
        return {
          month,
          spend: Math.round(monthlySpend[month]),
          cumulative: Math.round(cumulative),
          budget_line: Math.round(monthlyBudget),
        };
      });
    },
  });

  if (isLoading || !trendData?.length) return null;

  return (
    <div className="stat-card">
      <h3 className="text-sm font-medium text-foreground mb-4">Monthly Spending Trend</h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={trendData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              color: "hsl(var(--foreground))",
            }}
          />
          <Legend />
          <Line type="monotone" dataKey="spend" stroke="hsl(var(--primary))" strokeWidth={2} name="Monthly Spend" dot={{ r: 3 }} />
          <Line type="monotone" dataKey="cumulative" stroke="hsl(var(--chart-2))" strokeWidth={2} name="Cumulative" dot={{ r: 3 }} />
          <Line type="monotone" dataKey="budget_line" stroke="hsl(var(--destructive))" strokeWidth={1} strokeDasharray="5 5" name="Monthly Budget" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
