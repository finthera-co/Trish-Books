import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/currency";
import { Printer, Download } from "lucide-react";
import { toast } from "sonner";
import { generatePaySlipPdf } from "@/lib/paySlipPdf";
import { loadLogo, type LoadedLogo } from "@/lib/invoicePdf";
import { buildPayslipModel, maskAccount, payslipRef } from "@/lib/payslip";
import { amountInWords } from "@/lib/numberToWords";
import { useTenantBranding } from "@/hooks/useMyEmployee";
import { formatDate } from "@/lib/format";

interface Props {
  item: any;
  run: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional pre-fetched branding; falls back to useTenantBranding(). */
  tenant?: any;
}

export default function PayStub({ item, run, open, onOpenChange, tenant: tenantProp }: Props) {
  const { data: tenantFetched } = useTenantBranding();
  const tenant = tenantProp ?? tenantFetched;
  const [logo, setLogo] = useState<LoadedLogo | null>(null);

  useEffect(() => {
    let active = true;
    if (tenant?.logo_url) loadLogo(tenant.logo_url).then((l) => active && setLogo(l));
    else setLogo(null);
    return () => { active = false; };
  }, [tenant?.logo_url]);

  if (!item || !run) return null;

  const emp = item.employees ?? {};
  const fullName = `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim() || "Employee";
  const model = buildPayslipModel(item);

  const handleDownloadPdf = () => {
    try {
      generatePaySlipPdf(item, run, tenant, logo);
    } catch (e: any) {
      toast.error("Could not generate PDF: " + (e?.message ?? "unknown error"));
    }
  };

  const Row = ({ label, value, deduction, bold }: { label: string; value: number; deduction?: boolean; bold?: boolean }) => (
    <div className={`flex justify-between ${bold ? "font-bold border-t border-border pt-1" : ""}`}>
      <span className="text-foreground">{label}</span>
      <span className={deduction ? "text-destructive" : ""}>{deduction ? "-" : ""}{formatCurrency(value)}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payslip — {payslipRef(run, emp)}</DialogTitle>
        </DialogHeader>

        <div className="border border-border rounded-lg overflow-hidden print:border-none" id="pay-stub">
          {/* Branded header */}
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white px-6 py-4 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {tenant?.logo_url && (
                <img src={tenant.logo_url} alt="" className="h-10 w-auto max-w-[120px] object-contain bg-white/90 rounded p-1" />
              )}
              <div className="min-w-0">
                <p className="font-bold text-base truncate">{tenant?.company_name || "Your Company"}</p>
                {tenant?.registration_number && <p className="text-[11px] text-white/80">Reg. No: {tenant.registration_number}</p>}
                {tenant?.country && <p className="text-[11px] text-white/80">{tenant.country}</p>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-bold tracking-wide">PAYSLIP</p>
              <p className="text-[11px] text-white/85">{formatDate(run.period_start)} → {formatDate(run.period_end)}</p>
              {run.payment_date && <p className="text-[11px] text-white/85">Paid: {formatDate(run.payment_date)}</p>}
            </div>
          </div>

          <div className="p-6 space-y-4">
            {/* Employee info */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Field label="Employee" value={fullName} />
              <Field label="Designation" value={emp.designation || "N/A"} />
              <Field label="Employee No." value={emp.employee_number || "N/A"} />
              <Field label="EPF No." value={emp.epf_number || "N/A"} />
              <Field label="Bank Account" value={maskAccount(emp.bank_account_no)} />
              <Field label="Payment Method" value={item.payment_method === "bank_transfer" ? "Bank Transfer" : "Cash"} />
            </div>

            {/* Earnings */}
            <div>
              <h4 className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase mb-1">Earnings</h4>
              <div className="space-y-1 text-sm">
                {model.earnings.map((e, i) => <Row key={i} label={e.label} value={e.amount} deduction={e.deduction} />)}
                {model.workedHoursText && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Worked hours</span><span>{model.workedHoursText}</span>
                  </div>
                )}
                <Row label="Gross Pay" value={model.grossPay} bold />
              </div>
            </div>

            {/* Deductions */}
            <div>
              <h4 className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase mb-1">Deductions</h4>
              <div className="space-y-1 text-sm">
                {model.deductions.map((d, i) => <Row key={i} label={d.label} value={d.amount} deduction />)}
                <Row label="Total Deductions" value={model.totalDeductions} deduction bold />
              </div>
            </div>

            {/* Net Pay */}
            <div className="bg-indigo-50 dark:bg-indigo-950/40 rounded-lg p-3">
              <div className="flex justify-between text-lg font-bold">
                <span className="text-foreground">Net Pay</span>
                <span className="text-indigo-600 dark:text-indigo-400">{formatCurrency(model.netPay)}</span>
              </div>
              <p className="text-[11px] text-muted-foreground italic mt-0.5">{amountInWords(model.netPay, "Rupees")}</p>
            </div>

            {/* Employer contributions */}
            <div className="text-xs text-muted-foreground border-t border-border pt-2">
              <p className="font-semibold mb-1">Employer Contributions (not deducted from salary)</p>
              <div className="flex justify-between"><span>EPF (12%)</span><span>{formatCurrency(model.employerEpf)}</span></div>
              <div className="flex justify-between"><span>ETF (3%)</span><span>{formatCurrency(model.employerEtf)}</span></div>
              {model.taxableBenefit != null && (
                <div className="flex justify-between mt-1 pt-1 border-t border-border/60">
                  <span>Taxable non-cash benefit (BIK)</span><span>{formatCurrency(model.taxableBenefit)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadPdf}>
            <Download className="w-4 h-4" /> Download PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4" /> Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-semibold text-foreground">{value}</p>
    </div>
  );
}
