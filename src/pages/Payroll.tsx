import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { usePayrollRecords, useCreatePayrollRecord, useEmployees } from "@/hooks/useData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export default function Payroll() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [grossSalary, setGrossSalary] = useState(0);
  const [deductions, setDeductions] = useState(0);
  const [paymentDate, setPaymentDate] = useState("");

  const { data: records, isLoading } = usePayrollRecords();
  const { data: employees } = useEmployees();
  const createRecord = useCreatePayrollRecord();

  const netSalary = grossSalary - deductions;

  const filtered = records?.filter((r) => {
    const name = `${(r.employees as any)?.first_name || ""} ${(r.employees as any)?.last_name || ""}`.toLowerCase();
    return name.includes(search.toLowerCase());
  }) || [];

  const handleCreate = async () => {
    await createRecord.mutateAsync({
      employee_id: employeeId,
      period_start: periodStart,
      period_end: periodEnd,
      gross_salary: grossSalary,
      deductions,
      net_salary: netSalary,
      payment_date: paymentDate || undefined,
    });
    setOpen(false);
    setEmployeeId("");
    setPeriodStart("");
    setPeriodEnd("");
    setGrossSalary(0);
    setDeductions(0);
    setPaymentDate("");
  };

  // Auto-fill salary when employee is selected
  const handleEmployeeChange = (id: string) => {
    setEmployeeId(id);
    const emp = employees?.find(e => e.id === id);
    if (emp?.salary) setGrossSalary(Number(emp.salary));
  };

  const totalGross = records?.reduce((s, r) => s + Number(r.gross_salary), 0) || 0;
  const totalNet = records?.reduce((s, r) => s + Number(r.net_salary), 0) || 0;
  const totalDeductions = records?.reduce((s, r) => s + Number(r.deductions), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll</h1>
          <p className="page-description">Manage employee salaries and payment records</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" />Create Payroll</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Payroll Record</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm font-medium">Employee</label>
                <select value={employeeId} onChange={(e) => handleEmployeeChange(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                  <option value="">Select employee...</option>
                  {employees?.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
                </select>
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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Gross Salary</label>
                  <input type="number" value={grossSalary || ""} onChange={(e) => setGrossSalary(Number(e.target.value))}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
                <div>
                  <label className="text-sm font-medium">Deductions</label>
                  <input type="number" value={deductions || ""} onChange={(e) => setDeductions(Number(e.target.value))}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Net Salary</label>
                  <p className="mt-1 text-lg font-semibold text-foreground">LKR {netSalary.toLocaleString()}</p>
                </div>
                <div>
                  <label className="text-sm font-medium">Payment Date</label>
                  <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
              </div>
              <Button onClick={handleCreate} disabled={!employeeId || !periodStart || !periodEnd || createRecord.isPending} className="w-full">
                {createRecord.isPending ? "Creating..." : "Create Payroll Record"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card"><p className="text-sm text-muted-foreground">Total Gross</p><p className="text-xl font-semibold text-foreground mt-1">LKR {totalGross.toLocaleString()}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Total Deductions</p><p className="text-xl font-semibold text-warning mt-1">LKR {totalDeductions.toLocaleString()}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Total Net Pay</p><p className="text-xl font-semibold text-success mt-1">LKR {totalNet.toLocaleString()}</p></div>
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search payroll records..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>

        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No payroll records found. Create your first payroll record.</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Employee</th><th>Department</th><th>Period</th><th className="text-right">Gross</th><th className="text-right">Deductions</th><th className="text-right">Net Pay</th><th>Payment Date</th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium text-foreground">{(r.employees as any)?.first_name} {(r.employees as any)?.last_name}</td>
                  <td>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                      {(r.employees as any)?.department || "N/A"}
                    </span>
                  </td>
                  <td className="text-muted-foreground">{r.period_start} to {r.period_end}</td>
                  <td className="text-right">${Number(r.gross_salary).toLocaleString()}</td>
                  <td className="text-right text-warning">${Number(r.deductions).toLocaleString()}</td>
                  <td className="text-right font-medium text-success">${Number(r.net_salary).toLocaleString()}</td>
                  <td className="text-muted-foreground">{r.payment_date || "Unpaid"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
