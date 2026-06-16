import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEmployeeCompensation, useAddCompensation } from "@/hooks/useData";
import { formatCurrency } from "@/lib/currency";
import { useMyPermissions } from "@/hooks/usePermissions";

export default function CompensationDialog({
  employee, open, onOpenChange,
}: { employee: any; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: history } = useEmployeeCompensation(employee?.id);
  const addComp = useAddCompensation();
  const { canEdit } = useMyPermissions();
  const allowed = canEdit("payroll"); // tighten to a dedicated key if/when one exists

  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split("T")[0]);
  const [basic, setBasic] = useState(0);
  const [rate, setRate] = useState(0);
  const isHourly = employee?.pay_rate_type === "hourly";

  const submit = async () => {
    await addComp.mutateAsync({
      employee_id: employee.id,
      effective_from: effectiveFrom,
      basic_salary: isHourly ? 0 : Number(basic),
      pay_rate: isHourly ? Number(rate) : 0,
      pay_frequency: employee?.pay_rate_type === "hourly" ? "hourly" : "monthly",
    });
    setBasic(0); setRate(0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Compensation — {employee?.first_name} {employee?.last_name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <p className="text-sm font-medium text-muted-foreground">History</p>
          <div className="rounded-md border divide-y">
            {history?.length ? history.map((h: any) => (
              <div key={h.id} className="flex justify-between px-3 py-2 text-sm">
                <span>{h.effective_from}{h.is_current && <span className="ml-2 text-xs text-green-600">current</span>}</span>
                <span className="font-medium">
                  {Number(h.pay_rate) > 0
                    ? `${formatCurrency(Number(h.pay_rate))}/hr`
                    : formatCurrency(Number(h.basic_salary))}
                </span>
              </div>
            )) : <div className="px-3 py-4 text-sm text-muted-foreground">No compensation set.</div>}
          </div>
        </div>

        {allowed && (
          <div className="space-y-3 pt-4 border-t mt-2">
            <p className="text-sm font-medium">Add / change compensation</p>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Effective From</Label><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
              {isHourly
                ? <div><Label>Hourly Rate</Label><Input type="number" value={rate} onChange={(e) => setRate(Number(e.target.value))} /></div>
                : <div><Label>Basic Salary (monthly)</Label><Input type="number" value={basic} onChange={(e) => setBasic(Number(e.target.value))} /></div>}
            </div>
            <div className="flex justify-end">
              <Button onClick={submit} disabled={addComp.isPending}>
                {addComp.isPending ? "Saving..." : "Save compensation"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
