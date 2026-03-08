import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const mockBudgets = [
  { department: "Marketing", budget: 25000, actual: 22400, variance: -2600 },
  { department: "Engineering", budget: 45000, actual: 48200, variance: 3200 },
  { department: "Sales", budget: 18000, actual: 16500, variance: -1500 },
  { department: "Operations", budget: 12000, actual: 11800, variance: -200 },
  { department: "HR", budget: 8000, actual: 9100, variance: 1100 },
];

export default function Budgets() {
  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Budgeting</h1>
          <p className="page-description">Plan and track departmental budgets</p>
        </div>
        <Button><Plus className="w-4 h-4" />Create Budget</Button>
      </div>

      <div className="stat-card">
        <h3 className="text-sm font-medium text-foreground mb-4">Budget vs Actual by Department</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={mockBudgets}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 20% 90%)" />
            <XAxis dataKey="department" tick={{ fontSize: 12 }} stroke="hsl(215 14% 46%)" />
            <YAxis tick={{ fontSize: 12 }} stroke="hsl(215 14% 46%)" />
            <Tooltip />
            <Bar dataKey="budget" fill="hsl(215 60% 42%)" radius={[4, 4, 0, 0]} name="Budget" />
            <Bar dataKey="actual" fill="hsl(38 92% 50%)" radius={[4, 4, 0, 0]} name="Actual" opacity={0.8} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="stat-card">
        <table className="data-table">
          <thead><tr><th>Department</th><th className="text-right">Budget</th><th className="text-right">Actual</th><th className="text-right">Variance</th><th className="text-right">% Used</th></tr></thead>
          <tbody>
            {mockBudgets.map((b) => (
              <tr key={b.department}>
                <td className="font-medium text-foreground">{b.department}</td>
                <td className="text-right">${b.budget.toLocaleString()}</td>
                <td className="text-right">${b.actual.toLocaleString()}</td>
                <td className={`text-right font-medium ${b.variance <= 0 ? "text-success" : "text-destructive"}`}>
                  {b.variance <= 0 ? "" : "+"}${b.variance.toLocaleString()}
                </td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${(b.actual / b.budget) > 1 ? "bg-destructive" : "bg-primary"}`}
                        style={{ width: `${Math.min((b.actual / b.budget) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm">{Math.round((b.actual / b.budget) * 100)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
