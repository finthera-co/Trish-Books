import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, ChevronDown, ChevronRight } from "lucide-react";
import { useEnhancedBudgets, useBudgetLineUsages, useUpdateBudgetStatus, useCreateNewVersion } from "@/hooks/useBudgets";
import { formatCurrency } from "@/lib/currency";
import BudgetCreateDialog from "./BudgetCreateDialog";
import BudgetLineDialog from "./BudgetLineDialog";
import BudgetTrendChart from "./BudgetTrendChart";
import BudgetHierarchy from "./BudgetHierarchy";
import { formatDate } from "@/lib/format";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    active: "bg-success/15 text-success border-success/30",
    closed: "bg-destructive/15 text-destructive border-destructive/30",
  };
  return <Badge variant="outline" className={map[status] || ""}>{status}</Badge>;
}

function UtilizationBar({ pct }: { pct: number }) {
  const color = pct > 100 ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-success";
  const textColor = pct > 100 ? "text-destructive" : pct >= 80 ? "text-warning" : "text-muted-foreground";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-xs font-medium tabular-nums ${textColor}`}>{pct.toFixed(0)}%</span>
    </div>
  );
}

function BudgetDetail({ budgetId }: { budgetId: string }) {
  const { data, isLoading } = useBudgetLineUsages(budgetId);
  if (isLoading) return <p className="text-sm text-muted-foreground py-2 px-4">Loading lines...</p>;
  if (!data?.lines?.length) return <p className="text-sm text-muted-foreground py-2 px-4">No budget lines. Add line items to track spending.</p>;

  return (
    <div className="px-4 pb-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground border-b">
            <th className="text-left py-1.5 font-medium">Account</th>
            <th className="text-left py-1.5 font-medium">Department</th>
            <th className="text-right py-1.5 font-medium">Allocated</th>
            <th className="text-right py-1.5 font-medium">Actual</th>
            <th className="text-right py-1.5 font-medium">Remaining</th>
            <th className="py-1.5 font-medium w-36">Utilization</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line: any) => {
            const pct = line.utilization_percentage || 0;
            const indicator = pct > 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
            return (
              <tr key={line.id} className="border-b border-muted/50">
                <td className="py-2 font-medium text-foreground">
                  {indicator} {line.accounts?.account_code} – {line.accounts?.account_name}
                </td>
                <td className="py-2 text-muted-foreground">{line.departments?.name || "—"}</td>
                <td className="py-2 text-right font-mono tabular-nums">{formatCurrency(line.allocated_amount)}</td>
                <td className="py-2 text-right font-mono tabular-nums">{formatCurrency(line.actual_amount)}</td>
                <td className={`py-2 text-right font-mono tabular-nums font-medium ${line.remaining_amount < 0 ? "text-destructive" : "text-success"}`}>
                  {formatCurrency(line.remaining_amount)}
                </td>
                <td className="py-2"><UtilizationBar pct={pct} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function BudgetDashboard() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filters = statusFilter !== "all" ? { status: statusFilter } : undefined;
  const { data: budgets, isLoading } = useEnhancedBudgets(filters);
  const updateStatus = useUpdateBudgetStatus();
  const createVersion = useCreateNewVersion();

  // Chart data
  const chartData = budgets?.filter(b => (b as any).status === "active").map((b) => {
    const items = (b.budget_items as any[]) || [];
    const totalAllocated = items.reduce((s: number, i: any) => s + Number(i.allocated_amount), 0);
    return {
      name: (b as any).name || b.department,
      budget: Number(b.total_budget),
      allocated: totalAllocated,
    };
  }) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Budgeting</h1>
          <p className="page-description">Plan, track, and control departmental spending with real-time validation</p>
        </div>
        <div className="flex items-center gap-2">
          <BudgetCreateDialog />
          <BudgetLineDialog budgets={budgets || []} />
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Budget vs Allocated by Department</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  color: "hsl(var(--foreground))",
                }}
              />
              <Legend />
              <Bar dataKey="budget" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Total Budget" />
              <Bar dataKey="allocated" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} name="Allocated" opacity={0.8} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Budget Table */}
      <div className="stat-card">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : !budgets?.length ? (
          <p className="text-center py-8 text-muted-foreground">No budgets found. Create your first budget to get started.</p>
        ) : (
          <div className="divide-y divide-border">
            {budgets.map((b) => {
              const items = (b.budget_items as any[]) || [];
              const totalAllocated = items.reduce((s: number, i: any) => s + Number(i.allocated_amount), 0);
              const isExpanded = expandedId === b.id;
              const status = (b as any).status || "draft";
              const version = (b as any).version || 1;

              return (
                <div key={b.id}>
                  <div
                    className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : b.id)}
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{(b as any).name || b.department}</span>
                        <StatusBadge status={status} />
                        <span className="text-xs text-muted-foreground">v{version}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {b.department} · {formatDate(b.period_start)} → {formatDate(b.period_end)} · {(b as any).period_type || "monthly"}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-mono tabular-nums">{formatCurrency(Number(b.total_budget))}</div>
                      <div className="text-xs text-muted-foreground">{items.length} line{items.length !== 1 ? "s" : ""} · {formatCurrency(totalAllocated)} allocated</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: b.id, status: "active" }); }}
                        >
                          Activate
                        </Button>
                      )}
                      {status === "active" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => { e.stopPropagation(); createVersion.mutate(b.id); }}
                            title="Create new version"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: b.id, status: "closed" }); }}
                          >
                            Close
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <>
                      <BudgetDetail budgetId={b.id} />
                      <div className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <BudgetTrendChart budgetId={b.id} startDate={b.period_start} endDate={b.period_end} />
                        <BudgetHierarchy budgetId={b.id} />
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
