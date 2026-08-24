import { useState, useMemo } from "react";
import { Download, FileText, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useChangesInEquity, type SoceBlock } from "@/hooks/useFinancialStatements";
import { ReportMasthead, formatReportDate, useReportCompany } from "@/components/reports/ReportMasthead";
import { downloadDataPdf } from "@/lib/reportPdf";
import { downloadDataExcel } from "@/lib/reportExcel";

function fmt(n: number | null | undefined): string {
  if (n == null) return "";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < -0.005 ? `(${s})` : s;
}

function defaultYearStart(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  d.setMonth(3, 1); // 1 April, previous year — matches this codebase's fiscal-year convention elsewhere
  return d.toISOString().slice(0, 10);
}

function defaultYearEnd(): string {
  const d = new Date();
  d.setMonth(2, 31); // 31 March, this year
  return d.toISOString().slice(0, 10);
}

interface MatrixRow {
  label: string;
  values: SoceBlock[keyof SoceBlock] | null;
  emphasis?: "bold" | "total";
}

function blockRows(block: SoceBlock): MatrixRow[] {
  return [
    { label: "Balance as at start of period", values: block.opening_balance },
    { label: "Prior Year Adjustment", values: block.prior_year_adjustment },
    { label: "Profit for the Year", values: block.profit_for_year },
    { label: "Dividends", values: block.dividends },
    { label: "Other Movements", values: block.other_movements },
    { label: "Balance as at end of period", values: block.closing_balance, emphasis: "total" },
  ];
}

export default function StatementOfChangesInEquity() {
  const { appUser } = useAuth();
  const [periodStart, setPeriodStart] = useState(defaultYearStart);
  const [periodEnd, setPeriodEnd] = useState(defaultYearEnd);
  const [cmpPeriodStart, setCmpPeriodStart] = useState<string | null>(null);
  const [cmpPeriodEnd, setCmpPeriodEnd] = useState<string | null>(null);

  const { data: company } = useReportCompany();
  const { data, isLoading, error } = useChangesInEquity(periodStart, periodEnd, cmpPeriodStart, cmpPeriodEnd);

  const exportRows = useMemo(() => {
    if (!data) return [];
    type Row = { period: string; label: string; stated_capital: number | null; revenue_reserves: number | null; total: number | null };
    const rows: Row[] = [];
    const add = (periodLabel: string, block: SoceBlock) => {
      for (const r of blockRows(block)) {
        rows.push({ period: periodLabel, label: r.label, stated_capital: r.values?.stated_capital ?? null, revenue_reserves: r.values?.revenue_reserves ?? null, total: r.values?.total ?? null });
      }
    };
    add(`${formatReportDate(periodStart)} – ${formatReportDate(periodEnd)}`, data.current_period);
    if (data.comparative_period && cmpPeriodStart && cmpPeriodEnd) {
      add(`${formatReportDate(cmpPeriodStart)} – ${formatReportDate(cmpPeriodEnd)}`, data.comparative_period);
    }
    return rows;
  }, [data, periodStart, periodEnd, cmpPeriodStart, cmpPeriodEnd]);

  const exportMetaBase = {
    companyName: company?.company_name,
    address: company?.address,
    phone: company?.phone,
    taxId: company?.tax_id,
    registrationNumber: company?.registration_number,
    title: "Statement Of Changes In Equity",
    subtitle: "Stated Capital and Revenue Reserves",
    dateLine: `For the period ${formatReportDate(periodStart)} to ${formatReportDate(periodEnd)}`,
    preparedBy: [appUser?.first_name, appUser?.last_name].filter(Boolean).join(" "),
  };

  const columns = [
    { header: "Period", value: (r: any) => r.period },
    { header: "Movement", value: (r: any) => r.label },
    { header: "Stated Capital", numeric: true, value: (r: any) => r.stated_capital },
    { header: "Revenue Reserves", numeric: true, value: (r: any) => r.revenue_reserves },
    { header: "Total", numeric: true, value: (r: any) => r.total },
  ];

  const exportPdf = () => downloadDataPdf({ ...exportMetaBase, fileName: "statement-of-changes-in-equity.pdf" }, columns, exportRows);
  const exportExcel = () => downloadDataExcel({ ...exportMetaBase, fileName: "statement-of-changes-in-equity.xlsx" }, columns, exportRows);

  const renderBlock = (title: string, block: SoceBlock) => (
    <div className="mb-6">
      <p className="font-semibold text-sm text-foreground mb-2">{title}</p>
      <table className="w-full text-sm max-w-2xl report-table">
        <thead>
          <tr className="border-b-2 border-foreground/30">
            <th className="text-left py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground"></th>
            <th className="text-right py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-32">Stated Capital</th>
            <th className="text-right py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-32">Revenue Reserves</th>
            <th className="text-right py-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground w-32">Total</th>
          </tr>
        </thead>
        <tbody>
          {blockRows(block).map((r) => (
            <tr key={r.label} className={r.emphasis === "total" ? "font-bold border-t-2 border-double border-foreground/60" : ""}>
              <td className="py-1.5 pr-2 text-foreground">{r.label}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">{fmt(r.values?.stated_capital)}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">{fmt(r.values?.revenue_reserves)}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">{fmt(r.values?.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="stat-card print:hidden">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Period start</label>
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}
              className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Period end</label>
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}
              className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Comparative start</label>
            <input type="date" value={cmpPeriodStart ?? ""} onChange={(e) => setCmpPeriodStart(e.target.value || null)}
              className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Comparative end</label>
            <input type="date" value={cmpPeriodEnd ?? ""} onChange={(e) => setCmpPeriodEnd(e.target.value || null)}
              className="text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </div>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={exportPdf} disabled={!exportRows.length}>
              <FileText className="w-4 h-4 mr-1" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={!exportRows.length}>
              <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="w-4 h-4 mr-1" /> Print
            </Button>
          </div>
        </div>
      </div>

      <div className="stat-card print:shadow-none">
        <ReportMasthead
          title="Statement Of Changes In Equity"
          subtitle="Stated Capital and Revenue Reserves"
          periodCaption={`For the Year Ended ${new Date(periodEnd).getFullYear()}`}
          currency="LKR"
          scope={[
            { label: "Reporting period", value: `${formatReportDate(periodStart)} to ${formatReportDate(periodEnd)}` },
            cmpPeriodStart && cmpPeriodEnd
              ? { label: "Comparative", value: `${formatReportDate(cmpPeriodStart)} to ${formatReportDate(cmpPeriodEnd)}` }
              : null,
          ]}
        />

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-16 text-destructive">
            <p className="font-medium">Failed to load the statement.</p>
            <p className="text-sm mt-1">{(error as Error).message}</p>
          </div>
        ) : !data ? (
          <div className="text-center py-16 text-muted-foreground">No data for this period.</div>
        ) : (
          <div className="max-w-2xl mx-auto">
            {renderBlock(`${new Date(periodStart).getFullYear()}/${new Date(periodEnd).getFullYear()}`, data.current_period)}
            {data.comparative_period && cmpPeriodStart && cmpPeriodEnd &&
              renderBlock(`${new Date(cmpPeriodStart).getFullYear()}/${new Date(cmpPeriodEnd).getFullYear()}`, data.comparative_period)}
            <p className="text-xs text-muted-foreground mt-4">
              Prior Year Adjustment is not currently tracked as a distinct entry type in this system, so it always reads zero;
              any unclassified equity movement is captured under "Other Movements" instead.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
