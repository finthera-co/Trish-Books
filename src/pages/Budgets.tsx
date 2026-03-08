import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBudgets, useCreateBudget, useCreateBudgetItem, useAccounts } from "@/hooks/useData";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";

export default function Budgets() {
  const [open, setOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [selectedBudgetId, setSelectedBudgetId] = useState("");
  const [itemAccountId, setItemAccountId] = useState("");
  const [itemAmount, setItemAmount] = useState(0);
  const [department, setDepartment] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [totalBudget, setTotalBudget] = useState(0);

  const { data: budgets, isLoading } = useBudgets();
  const createBudget = useCreateBudget();
  const createBudgetItem = useCreateBudgetItem();
  const { data: accounts } = useAccounts();

  const handleAddItem = async () => {
    await createBudgetItem.mutateAsync({
      budget_id: selectedBudgetId,
      account_id: itemAccountId,
      allocated_amount: itemAmount,
    });
    setItemOpen(false);
    setItemAccountId("");
    setItemAmount(0);
  };

  const handleCreate = async () => {
    await createBudget.mutateAsync({
      department,
      period_start: periodStart,
      period_end: periodEnd,
      total_budget: totalBudget,
    });
    setOpen(false);
    setDepartment("");
    setPeriodStart("");
    setPeriodEnd("");
    setTotalBudget(0);
  };

  // Transform data for chart
  const chartData = budgets?.map(b => {
    const actual = (b.budget_items as any[])?.reduce((sum, item) => {
      const variance = (item.budget_variances as any[])?.[0];
      return sum + (variance?.actual_amount || 0);
    }, 0) || 0;
    return {
      department: b.department,
      budget: Number(b.total_budget),
      actual,
    };
  }) || [];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Budgeting</h1>
          <p className="page-description">Plan and track departmental budgets</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" />Create Budget</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Budget</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm font-medium">Department</label>
                <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="Marketing" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Period Start</label>
                  <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
                <div>
                  <label className="text-sm font-medium">Period End</label>
                  <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Total Budget</label>
                <input type="number" value={totalBudget || ""} onChange={(e) => setTotalBudget(Number(e.target.value))}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
              </div>
              <Button onClick={handleCreate} disabled={!department || !periodStart || !periodEnd || createBudget.isPending} className="w-full">
                {createBudget.isPending ? "Creating..." : "Create Budget"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={itemOpen} onOpenChange={setItemOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" disabled={!budgets?.length}>Add Budget Item</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Budget Line Item</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm font-medium">Budget</label>
                <select value={selectedBudgetId} onChange={(e) => setSelectedBudgetId(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                  <option value="">Select budget...</option>
                  {budgets?.map(b => <option key={b.id} value={b.id}>{b.department} ({b.period_start})</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Account</label>
                <select value={itemAccountId} onChange={(e) => setItemAccountId(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                  <option value="">Select account...</option>
                  {accounts?.map(a => <option key={a.id} value={a.id}>{a.account_code} - {a.account_name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Allocated Amount</label>
                <input type="number" value={itemAmount || ""} onChange={(e) => setItemAmount(Number(e.target.value))}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
              </div>
              <Button onClick={handleAddItem} disabled={!selectedBudgetId || !itemAccountId || !itemAmount || createBudgetItem.isPending} className="w-full">
                {createBudgetItem.isPending ? "Adding..." : "Add Item"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {chartData.length > 0 && (
        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Budget vs Actual by Department</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 20% 90%)" />
              <XAxis dataKey="department" tick={{ fontSize: 12 }} stroke="hsl(215 14% 46%)" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(215 14% 46%)" />
              <Tooltip />
              <Bar dataKey="budget" fill="hsl(215 60% 42%)" radius={[4, 4, 0, 0]} name="Budget" />
              <Bar dataKey="actual" fill="hsl(38 92% 50%)" radius={[4, 4, 0, 0]} name="Actual" opacity={0.8} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="stat-card">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : !budgets?.length ? (
          <p className="text-center py-8 text-muted-foreground">No budgets found. Create your first budget to get started.</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Department</th><th>Period</th><th className="text-right">Budget</th><th className="text-right">Actual</th><th className="text-right">Variance</th></tr></thead>
            <tbody>
              {budgets.map((b) => {
                const actual = (b.budget_items as any[])?.reduce((sum, item) => {
                  const variance = (item.budget_variances as any[])?.[0];
                  return sum + (variance?.actual_amount || 0);
                }, 0) || 0;
                const variance = actual - Number(b.total_budget);
                return (
                  <tr key={b.id}>
                    <td className="font-medium text-foreground">{b.department}</td>
                    <td className="text-muted-foreground">{b.period_start} to {b.period_end}</td>
                    <td className="text-right">LKR {Number(b.total_budget).toLocaleString()}</td>
                    <td className="text-right">LKR {actual.toLocaleString()}</td>
                    <td className={`text-right font-medium ${variance <= 0 ? "text-success" : "text-destructive"}`}>
                      {variance <= 0 ? "" : "+"}LKR {variance.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
