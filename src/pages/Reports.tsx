import { FileText, Download, BarChart3, TrendingUp, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";

const reports = [
  { name: "Profit & Loss Statement", description: "Revenue, expenses, and net profit for the period", icon: TrendingUp, category: "Financial" },
  { name: "Balance Sheet", description: "Assets, liabilities, and equity snapshot", icon: DollarSign, category: "Financial" },
  { name: "Cash Flow Statement", description: "Operating, investing, and financing cash flows", icon: BarChart3, category: "Financial" },
  { name: "Trial Balance", description: "Verify total debits equal total credits", icon: FileText, category: "Accounting" },
  { name: "Budget vs Actual", description: "Compare planned budgets to actual spending", icon: BarChart3, category: "Planning" },
  { name: "Aged Receivables", description: "Outstanding customer invoices by age", icon: FileText, category: "Billing" },
  { name: "Expense Summary", description: "Expense breakdown by category and period", icon: FileText, category: "Operations" },
  { name: "Audit Trail", description: "Complete log of all financial transactions", icon: FileText, category: "Compliance" },
];

export default function Reports() {
  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Financial Reports</h1>
          <p className="page-description">Generate and download financial statements</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reports.map((report) => (
          <div key={report.name} className="stat-card flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <report.icon className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-foreground">{report.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{report.description}</p>
              <div className="flex items-center gap-2 mt-3">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                  {report.category}
                </span>
              </div>
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="sm">View</Button>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Download className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
