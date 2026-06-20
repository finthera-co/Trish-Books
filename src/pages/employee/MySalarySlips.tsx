import { useState } from "react";
import { useMyEmployee, useMyPayslips } from "@/hooks/useMyEmployee";
import { formatCurrency } from "@/lib/currency";
import { FileText, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import PayStub from "@/components/payroll/PayStub";

export default function MySalarySlips() {
  const { data: me } = useMyEmployee();
  const { data: slips, isLoading } = useMyPayslips(me?.id);
  const [active, setActive] = useState<any>(null);

  return (
    <div className="px-4 sm:px-6 py-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Salary Slips</h1>
        <p className="text-sm text-muted-foreground">View and download your pay stubs</p>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm divide-y divide-border">
        {isLoading ? (
          <p className="text-center text-sm text-muted-foreground py-10">Loading…</p>
        ) : !slips?.length ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No salary slips yet.</p>
          </div>
        ) : (
          slips.map((it: any) => (
            <div key={it.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{it.payroll_runs.run_number || "Payroll"}</p>
                <p className="text-xs text-muted-foreground">{it.payroll_runs.period_start} → {it.payroll_runs.period_end}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-foreground">{formatCurrency(Number(it.net_pay))}</p>
                <p className="text-[11px] text-muted-foreground">Net pay</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setActive(it)}>
                <Eye className="w-3.5 h-3.5" /> View
              </Button>
            </div>
          ))
        )}
      </div>

      <PayStub item={active} run={active?.payroll_runs} open={!!active} onOpenChange={(o) => !o && setActive(null)} />
    </div>
  );
}
