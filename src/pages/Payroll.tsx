import { useState } from "react";
import { Plus, Search, Eye, DollarSign, Users, TrendingUp, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePayrollRuns, usePayrollRunItems } from "@/hooks/usePayroll";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useEmployees } from "@/hooks/useData";
import { formatCurrency } from "@/lib/currency";
import PayrollRunForm from "@/components/payroll/PayrollRunForm";
import PayrollRunDetails from "@/components/payroll/PayrollRunDetails";
import PayStub from "@/components/payroll/PayStub";
import PayScheduleManager from "@/components/payroll/PayScheduleManager";
import { exportToCsv } from "@/lib/csvExport";

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  processed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  voided: "bg-destructive/10 text-destructive",
};

export default function Payroll() {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [payStubItem, setPayStubItem] = useState<any>(null);
  const [payStubRun, setPayStubRun] = useState<any>(null);
  const [payStubOpen, setPayStubOpen] = useState(false);

  const { data: runs, isLoading } = usePayrollRuns();
  const { data: employees } = useEmployees();

  const filteredRuns = runs?.filter((r: any) =>
    r.run_number.toLowerCase().includes(search.toLowerCase()) ||
    r.status.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const totalNetThisMonth = runs
    ?.filter((r: any) => r.status === "processed")
    .reduce((s: number, r: any) => s + Number(r.total_net), 0) || 0;

  const totalGrossThisMonth = runs
    ?.filter((r: any) => r.status === "processed")
    .reduce((s: number, r: any) => s + Number(r.total_gross), 0) || 0;

  const pendingRuns = runs?.filter((r: any) => r.status === "draft" || r.status === "approved").length || 0;

  const [exporting, setExporting] = useState(false);

  const exportFullBreakdown = async () => {
    if (!filteredRuns.length) return;
    setExporting(true);
    try {
      // Fetch all run items with employee details for all visible runs
      const runIds = filteredRuns.map((r: any) => r.id);
      const { data: allItems, error } = await supabase
        .from("payroll_run_items")
        .select("*, employees(first_name, last_name, department, epf_number, bank_name, bank_account_no)")
        .in("run_id", runIds)
        .order("created_at");
      if (error) throw error;

      // Build a lookup for run info
      const runMap: Record<string, any> = {};
      filteredRuns.forEach((r: any) => { runMap[r.id] = r; });

      const headers = [
        "Run #", "Period Start", "Period End", "Status", "Payment Date",
        "Employee Name", "Department", "EPF No.", "Bank", "Account No.",
        "Basic Salary", "Overtime Pay", "Bonuses", "Allowances", "Gross Pay",
        "Employee EPF (8%)", "Employer EPF (12%)", "Employer ETF (3%)",
        "Other Deductions", "Total Deductions", "Net Pay", "Payment Method",
      ];

      const rows = (allItems || []).map((item: any) => {
        const run = runMap[item.run_id];
        const emp = item.employees as any;
        const totalDed = Number(item.employee_epf) + Number(item.other_deductions);
        return [
          run?.run_number || "", run?.period_start || "", run?.period_end || "",
          run?.status || "", run?.payment_date || "",
          `${emp?.first_name || ""} ${emp?.last_name || ""}`.trim(),
          emp?.department || "", emp?.epf_number || "",
          emp?.bank_name || "", emp?.bank_account_no || "",
          Number(item.basic_salary).toFixed(2),
          Number(item.overtime_pay).toFixed(2),
          Number(item.bonuses).toFixed(2),
          Number(item.allowances).toFixed(2),
          Number(item.gross_pay).toFixed(2),
          Number(item.employee_epf).toFixed(2),
          Number(item.employer_epf).toFixed(2),
          Number(item.employer_etf).toFixed(2),
          Number(item.other_deductions).toFixed(2),
          totalDed.toFixed(2),
          Number(item.net_pay).toFixed(2),
          item.payment_method === "bank_transfer" ? "Bank Transfer" : "Cash",
        ];
      });

      exportToCsv(`payroll-employee-breakdown-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
      toast.success(`Exported ${rows.length} employee records`);
    } catch (e: any) {
      toast.error("Export failed: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  const openDetails = (run: any) => {
    setSelectedRun(run);
    setDetailsOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll Management</h1>
          <p className="page-description">Run payroll, manage schedules, and generate pay stubs (Sri Lanka EPF/ETF)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportFullBreakdown} disabled={!filteredRuns.length || exporting}>
            <Download className="w-4 h-4" /> {exporting ? "Exporting..." : "Export CSV"}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> Run Payroll
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <DollarSign className="w-4 h-4" />
            <p className="text-sm">Total Net Paid</p>
          </div>
          <p className="text-xl font-semibold text-foreground">{formatCurrency(totalNetThisMonth)}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <TrendingUp className="w-4 h-4" />
            <p className="text-sm">Total Gross</p>
          </div>
          <p className="text-xl font-semibold text-foreground">{formatCurrency(totalGrossThisMonth)}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Users className="w-4 h-4" />
            <p className="text-sm">Active Employees</p>
          </div>
          <p className="text-xl font-semibold text-foreground">{employees?.filter((e: any) => (e.status || "active") === "active").length || 0}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <FileText className="w-4 h-4" />
            <p className="text-sm">Pending Runs</p>
          </div>
          <p className="text-xl font-semibold text-foreground">{pendingRuns}</p>
        </div>
      </div>

      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">Payroll Runs</TabsTrigger>
          <TabsTrigger value="schedules">Pay Schedules</TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="space-y-4">
          <div className="stat-card">
            <div className="flex items-center gap-3 mb-4">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input type="text" placeholder="Search payroll runs..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
            </div>

            {isLoading ? (
              <p className="text-center py-8 text-muted-foreground">Loading...</p>
            ) : filteredRuns.length === 0 ? (
              <div className="text-center py-12">
                <DollarSign className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">No payroll runs yet. Click "Run Payroll" to get started.</p>
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Run #</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Period</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Schedule</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Gross</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Deductions</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Net Pay</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Payment Date</th>
                      <th className="px-4 py-3 text-center font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRuns.map((run: any) => (
                      <tr key={run.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">{run.run_number}</td>
                        <td className="px-4 py-3 text-muted-foreground">{run.period_start} — {run.period_end}</td>
                        <td className="px-4 py-3 text-muted-foreground">{(run.pay_schedules as any)?.name || "Manual"}</td>
                        <td className="px-4 py-3">
                          <Badge className={statusColors[run.status]}>{run.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right">{formatCurrency(Number(run.total_gross))}</td>
                        <td className="px-4 py-3 text-right text-destructive">{formatCurrency(Number(run.total_deductions))}</td>
                        <td className="px-4 py-3 text-right font-semibold text-primary">{formatCurrency(Number(run.total_net))}</td>
                        <td className="px-4 py-3 text-muted-foreground">{run.payment_date || "—"}</td>
                        <td className="px-4 py-3 text-center">
                          <Button variant="ghost" size="sm" onClick={() => openDetails(run)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="schedules">
          <PayScheduleManager />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <PayrollRunForm open={createOpen} onOpenChange={setCreateOpen} />
      <PayrollRunDetails run={selectedRun} open={detailsOpen} onOpenChange={setDetailsOpen} />
      <PayStub item={payStubItem} run={payStubRun} open={payStubOpen} onOpenChange={setPayStubOpen} />
    </div>
  );
}
