import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useBudgetVsActual, useBudgetControls, useUpsertBudgetControls } from "@/hooks/useBudgetReporting";
import { formatCurrency } from "@/lib/currency";
import { downloadReportExcel } from "@/lib/reportExcel";
import { Save, FileSpreadsheet } from "lucide-react";

function VarianceBadge({ pct }: { pct: number }) {
  const tone =
    pct > 100 ? "bg-destructive/15 text-destructive border-destructive/30"
    : pct >= 80 ? "bg-warning/15 text-warning border-warning/30"
    : "bg-success/15 text-success border-success/30";
  return <Badge variant="outline" className={tone + " tabular-nums"}>{pct.toFixed(1)}%</Badge>;
}

export default function BudgetVsActualReport() {
  const currentYear = new Date().getFullYear();
  const [fiscalYear, setFiscalYear] = useState<number>(currentYear);
  const [accountType, setAccountType] = useState<string>("all");

  const { data: rows, isLoading } = useBudgetVsActual({
    fiscalYear,
    accountType: accountType === "all" ? undefined : accountType,
  });

  const { data: controls } = useBudgetControls();
  const upsert = useUpsertBudgetControls();
  const [draft, setDraft] = useState<any>(null);
  const merged = draft ?? controls ?? {
    enforcement_mode: "warn",
    tolerance_percentage: 0,
    apply_to_accounts: "expense_only",
    dimension_strict_mode: false,
    missing_budget_behavior: "allow",
  };

  const totals = (rows ?? []).reduce(
    (acc, r) => {
      acc.allocated += Number(r.allocated);
      acc.actual += Number(r.actual);
      return acc;
    },
    { allocated: 0, actual: 0 }
  );

  const handleExportExcel = () => {
    const container = document.getElementById("budget-vs-actual-doc");
    if (!container) return;
    downloadReportExcel(container, {
      title: "Budget vs Actual",
      subtitle: accountType === "all" ? "All account types" : accountType,
      dateLine: `Fiscal year ${fiscalYear}`,
      sheetName: `Budget vs Actual ${fiscalYear}`,
      fileName: `Budget vs Actual ${fiscalYear}.xlsx`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Budget vs Actual</h1>
          <p className="page-description">Compare planned vs actual spending across periods, departments, and account types.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!rows?.length}>
          <FileSpreadsheet className="w-4 h-4 mr-1" /> Export Excel
        </Button>
      </div>

      {/* Controls panel */}
      <div className="stat-card space-y-4">
        <h3 className="text-sm font-medium text-foreground">Enforcement Controls</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs">Enforcement mode</Label>
            <Select
              value={merged.enforcement_mode}
              onValueChange={(v) => setDraft({ ...merged, enforcement_mode: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None — no checks</SelectItem>
                <SelectItem value="warn">Warn only</SelectItem>
                <SelectItem value="block">Block over-budget posts</SelectItem>
                <SelectItem value="approval">Require approval</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Tolerance (%)</Label>
            <Input
              type="number" min={0} max={100} step={1}
              value={merged.tolerance_percentage}
              onChange={(e) => setDraft({ ...merged, tolerance_percentage: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs">Apply to</Label>
            <Select
              value={merged.apply_to_accounts}
              onValueChange={(v) => setDraft({ ...merged, apply_to_accounts: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense_only">Expense accounts only</SelectItem>
                <SelectItem value="revenue_only">Revenue accounts only</SelectItem>
                <SelectItem value="both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Missing budget behavior</Label>
            <Select
              value={merged.missing_budget_behavior}
              onValueChange={(v) => setDraft({ ...merged, missing_budget_behavior: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="allow">Allow</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="block">Block</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 pt-6">
            <Switch
              checked={!!merged.dimension_strict_mode}
              onCheckedChange={(c) => setDraft({ ...merged, dimension_strict_mode: c })}
            />
            <Label className="text-xs">Strict dimension match (no fallback)</Label>
          </div>
          <div className="flex items-end justify-end">
            <Button
              onClick={() => upsert.mutate(merged)}
              disabled={upsert.isPending}
            >
              <Save className="w-4 h-4 mr-2" /> Save controls
            </Button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div>
          <Label className="text-xs">Fiscal year</Label>
          <Input
            type="number"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(Number(e.target.value))}
            className="w-32"
          />
        </div>
        <div>
          <Label className="text-xs">Account type</Label>
          <Select value={accountType} onValueChange={setAccountType}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="Expense">Expense</SelectItem>
              <SelectItem value="Cost of Goods Sold">COGS</SelectItem>
              <SelectItem value="Revenue">Revenue</SelectItem>
              <SelectItem value="Income">Income</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Report table */}
      <div id="budget-vs-actual-doc" className="stat-card overflow-x-auto">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading…</p>
        ) : !rows?.length ? (
          <p className="text-center py-8 text-muted-foreground">No active or closed budgets in this fiscal year.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b">
                  <th className="text-left py-2 px-2 font-medium">Account</th>
                  <th className="text-left py-2 px-2 font-medium">Type</th>
                  <th className="text-left py-2 px-2 font-medium">Period</th>
                  <th className="text-right py-2 px-2 font-medium">Allocated</th>
                  <th className="text-right py-2 px-2 font-medium">Actual</th>
                  <th className="text-right py-2 px-2 font-medium">Variance</th>
                  <th className="text-right py-2 px-2 font-medium">Utilization</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-muted/40 hover:bg-muted/20">
                    <td className="py-2 px-2 font-medium">{r.account_code} — {r.account_name}</td>
                    <td className="py-2 px-2 text-muted-foreground">{r.account_type}</td>
                    <td className="py-2 px-2 text-muted-foreground">{r.period}</td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums">{formatCurrency(Number(r.allocated))}</td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums">{formatCurrency(Number(r.actual))}</td>
                    <td className={`py-2 px-2 text-right font-mono tabular-nums ${Number(r.variance) < 0 ? "text-destructive" : "text-success"}`}>
                      {formatCurrency(Number(r.variance))}
                    </td>
                    <td className="py-2 px-2 text-right"><VarianceBadge pct={Number(r.variance_pct)} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold border-t-2">
                  <td className="py-2 px-2" colSpan={3}>Totals</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">{formatCurrency(totals.allocated)}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">{formatCurrency(totals.actual)}</td>
                  <td className={`py-2 px-2 text-right font-mono tabular-nums ${totals.allocated - totals.actual < 0 ? "text-destructive" : "text-success"}`}>
                    {formatCurrency(totals.allocated - totals.actual)}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <VarianceBadge pct={totals.allocated > 0 ? (totals.actual / totals.allocated) * 100 : 0} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
