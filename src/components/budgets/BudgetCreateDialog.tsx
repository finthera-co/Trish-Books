import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCreateEnhancedBudget } from "@/hooks/useBudgets";

export default function BudgetCreateDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [periodType, setPeriodType] = useState("monthly");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [totalBudget, setTotalBudget] = useState(0);
  const [status, setStatus] = useState("draft");

  const createBudget = useCreateEnhancedBudget();

  const handleCreate = async () => {
    await createBudget.mutateAsync({
      name: name || department,
      department,
      period_start: periodStart,
      period_end: periodEnd,
      total_budget: totalBudget,
      status,
      period_type: periodType,
    });
    setOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setName("");
    setDepartment("");
    setPeriodType("monthly");
    setPeriodStart("");
    setPeriodEnd("");
    setTotalBudget(0);
    setStatus("draft");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="w-4 h-4 mr-1" />Create Budget</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Budget</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div>
            <Label>Budget Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q1 Marketing Budget" />
          </div>
          <div>
            <Label>Department</Label>
            <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Marketing" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Period Type</Label>
              <Select value={periodType} onValueChange={setPeriodType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Period Start</Label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div>
              <Label>Period End</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Total Budget (LKR)</Label>
            <Input type="number" value={totalBudget || ""} onChange={(e) => setTotalBudget(Number(e.target.value))} />
          </div>
          <Button
            onClick={handleCreate}
            disabled={!department || !periodStart || !periodEnd || createBudget.isPending}
            className="w-full"
          >
            {createBudget.isPending ? "Creating..." : "Create Budget"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
