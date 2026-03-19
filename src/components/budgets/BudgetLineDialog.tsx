import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCreateBudgetLine, useDepartments } from "@/hooks/useBudgets";
import { useAccounts } from "@/hooks/useData";

interface Props {
  budgets: any[];
}

export default function BudgetLineDialog({ budgets }: Props) {
  const [open, setOpen] = useState(false);
  const [budgetId, setBudgetId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState(0);
  const [threshold, setThreshold] = useState(80);
  const [departmentId, setDepartmentId] = useState("");

  const createLine = useCreateBudgetLine();
  const { data: accounts } = useAccounts();
  const { data: departments } = useDepartments();

  // Only show expense accounts for budget lines
  const expenseAccounts = accounts?.filter(
    (a) => a.account_type === "Expense" || a.account_type === "Cost of Goods Sold"
  );

  const handleAdd = async () => {
    await createLine.mutateAsync({
      budget_id: budgetId,
      account_id: accountId,
      allocated_amount: amount,
      warning_threshold: threshold / 100,
      department_id: departmentId || undefined,
    });
    setOpen(false);
    setAccountId("");
    setAmount(0);
    setThreshold(80);
    setDepartmentId("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!budgets?.length}>
          <Plus className="w-4 h-4 mr-1" />Add Budget Line
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Budget Line Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div>
            <Label>Budget</Label>
            <Select value={budgetId} onValueChange={setBudgetId}>
              <SelectTrigger><SelectValue placeholder="Select budget..." /></SelectTrigger>
              <SelectContent>
                {budgets?.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name || b.department} (v{(b as any).version || 1})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Expense Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Select account..." /></SelectTrigger>
              <SelectContent>
                {expenseAccounts?.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.account_code} – {a.account_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {departments && departments.length > 0 && (
            <div>
              <Label>Department (optional)</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger><SelectValue placeholder="All departments" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Allocated Amount (LKR)</Label>
              <Input type="number" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
            <div>
              <Label>Warning at (%)</Label>
              <Input type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} min={50} max={100} />
            </div>
          </div>
          <Button
            onClick={handleAdd}
            disabled={!budgetId || !accountId || !amount || createLine.isPending}
            className="w-full"
          >
            {createLine.isPending ? "Adding..." : "Add Line"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
