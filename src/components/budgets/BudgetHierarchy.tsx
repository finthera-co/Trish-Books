import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";

/**
 * Category-level budget summary: rolls up all budget lines 
 * under each account_type category (Expense, COGS, etc.)
 */
export default function BudgetHierarchy({ budgetId }: { budgetId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["budget_hierarchy", budgetId],
    enabled: !!budgetId,
    queryFn: async () => {
      const { data: budget, error } = await supabase
        .from("budgets")
        .select("*, budget_items(*, accounts(account_name, account_code, account_type, normal_balance))")
        .eq("id", budgetId)
        .single();
      if (error) throw error;

      const items = (budget.budget_items as any[]) || [];

      // Group by account_type
      const categories: Record<string, { allocated: number; items: any[] }> = {};
      items.forEach((item: any) => {
        const type = item.accounts?.account_type || "Other";
        if (!categories[type]) categories[type] = { allocated: 0, items: [] };
        categories[type].allocated += Number(item.allocated_amount);
        categories[type].items.push(item);
      });

      // Calculate actuals per category using the DB function
      const results = await Promise.all(
        Object.entries(categories).map(async ([type, cat]) => {
          let totalActual = 0;
          for (const item of cat.items) {
            const { data: usageData } = await supabase.rpc("calculate_budget_usage", {
              p_account_id: item.account_id,
              p_start_date: budget.period_start,
              p_end_date: budget.period_end,
            });
            const usage = (usageData as any[])?.[0];
            totalActual += usage?.actual_amount || 0;
          }
          return {
            type,
            allocated: cat.allocated,
            actual: totalActual,
            remaining: cat.allocated - totalActual,
            utilization: cat.allocated > 0 ? (totalActual / cat.allocated) * 100 : 0,
            lineCount: cat.items.length,
          };
        })
      );

      return results;
    },
  });

  if (isLoading || !data?.length) return null;

  return (
    <div className="stat-card">
      <h3 className="text-sm font-medium text-foreground mb-3">Category-Level Summary</h3>
      <div className="space-y-3">
        {data.map((cat) => {
          const pct = cat.utilization;
          const color = pct > 100 ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-success";
          const indicator = pct > 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
          return (
            <div key={cat.type} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{indicator} {cat.type} ({cat.lineCount} accounts)</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatCurrency(cat.actual)} / {formatCurrency(cat.allocated)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <span className={`text-xs font-medium tabular-nums ${pct > 100 ? "text-destructive" : "text-muted-foreground"}`}>
                  {pct.toFixed(0)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
