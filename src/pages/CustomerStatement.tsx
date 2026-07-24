import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer, FileText, Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { downloadStatementPdf, printStatementPdf } from "@/lib/statementPdf";
import { downloadReportExcel } from "@/lib/reportExcel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/currency";
import { useCustomerStatement } from "@/hooks/useCustomerStatement";

// First and last day of the current month, ISO.
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0]; };
const today = () => new Date().toISOString().split("T")[0];

export default function CustomerStatement() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { appUser } = useAuth();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());

  const { data: customer } = useQuery({
    queryKey: ["customer_hdr", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("customers")
        .select("name, legal_name, email, phone, address").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: company } = useQuery({
    queryKey: ["company_hdr", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants")
        .select("company_name, address, phone, tax_id").eq("id", appUser!.tenant_id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: stmt, isLoading } = useCustomerStatement(id, from, to);
  const aging = stmt?.aging;

  return (
    <div className="space-y-6">
      {/* Toolbar — hidden when printing */}
      <div className="flex items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
          <div>
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2"><FileText className="w-5 h-5 text-primary" /> Statement of Account</h1>
            <p className="text-sm text-muted-foreground">{customer?.name}</p>
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" /></div>
          <Button variant="outline" disabled={isLoading || !stmt} onClick={async () => {
            try { await printStatementPdf({ stmt: stmt!, customer, company, from, to }); }
            catch (e: any) { toast.error(e?.message || "Print failed"); }
          }}>
            <Printer className="w-4 h-4 mr-1.5" /> Print
          </Button>
          <Button variant="outline" disabled={isLoading || !stmt} onClick={() => {
            const container = document.getElementById("statement-doc");
            if (!container) return;
            const ok = downloadReportExcel(container, {
              companyName: company?.company_name,
              address: company?.address,
              phone: company?.phone,
              taxId: company?.tax_id,
              title: "Statement of Account",
              subtitle: customer?.legal_name || customer?.name || undefined,
              dateLine: `${from} → ${to}`,
              sheetName: "Statement",
              fileName: `Statement — ${customer?.name ?? "Customer"} ${to}.xlsx`,
            });
            if (ok) toast.success("Statement downloaded");
            else toast.error("Nothing to download for this period.");
          }}>
            <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Download Excel
          </Button>
          <Button disabled={isLoading || !stmt} onClick={async () => {
            try { await downloadStatementPdf({ stmt: stmt!, customer, company, from, to }); toast.success("Statement downloaded"); }
            catch (e: any) { toast.error(e?.message || "Download failed"); }
          }}>
            <Download className="w-4 h-4 mr-1.5" /> Download PDF
          </Button>
        </div>
      </div>

      {/* Printable document */}
      <Card className="print:border-0 print:shadow-none">
        <CardContent className="p-8 print:p-0" id="statement-doc">
          {/* Header */}
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-lg font-bold text-foreground">{company?.company_name || "Company"}</h2>
              {company?.address && <p className="text-sm text-muted-foreground whitespace-pre-line">{company.address}</p>}
              {company?.phone && <p className="text-sm text-muted-foreground">{company.phone}</p>}
              {company?.tax_id && <p className="text-sm text-muted-foreground">TIN: {company.tax_id}</p>}
            </div>
            <div className="text-right">
              <h3 className="text-xl font-bold tracking-tight text-foreground">STATEMENT</h3>
              <p className="text-sm text-muted-foreground">{from} → {to}</p>
            </div>
          </div>

          {/* Bill to */}
          <div className="mb-6 rounded-lg bg-muted/40 p-3 print:bg-transparent print:p-0 print:mb-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Statement for</p>
            <p className="font-semibold text-foreground">{customer?.legal_name || customer?.name}</p>
            {customer?.address && <p className="text-sm text-muted-foreground whitespace-pre-line">{customer.address}</p>}
            {customer?.email && <p className="text-sm text-muted-foreground">{customer.email}</p>}
          </div>

          {/* Ledger */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-border text-left text-muted-foreground">
                <th className="py-2">Date</th><th className="py-2">Type</th><th className="py-2">Reference</th>
                <th className="py-2 text-right">Debit</th><th className="py-2 text-right">Credit</th><th className="py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60">
                <td className="py-2 text-muted-foreground" colSpan={5}>Opening balance</td>
                <td className="py-2 text-right font-mono tabular-nums font-medium">{formatCurrency(stmt?.opening_balance ?? 0)}</td>
              </tr>
              {isLoading ? (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Loading…</td></tr>
              ) : (stmt?.rows.length ?? 0) === 0 ? (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No transactions in this period</td></tr>
              ) : (
                stmt!.rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-2 text-muted-foreground whitespace-nowrap">{r.date}</td>
                    <td className="py-2">{r.kind}</td>
                    <td className="py-2 font-medium">{r.reference}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{r.debit ? formatCurrency(r.debit) : "—"}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{r.credit ? formatCurrency(r.credit) : "—"}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{formatCurrency(r.balance)}</td>
                  </tr>
                ))
              )}
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2.5" colSpan={5}>Closing balance</td>
                <td className="py-2.5 text-right font-mono tabular-nums text-base">{formatCurrency(stmt?.closing_balance ?? 0)}</td>
              </tr>
            </tbody>
          </table>

          {/* Aging summary */}
          {aging && (
            <div className="mt-8">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Outstanding by age</p>
              <div className="grid grid-cols-5 gap-2 text-center">
                {[
                  { label: "Current", v: aging.current },
                  { label: "1–30", v: aging.d1_30 },
                  { label: "31–60", v: aging.d31_60 },
                  { label: "61–90", v: aging.d61_90 },
                  { label: "90+", v: aging.d90_plus },
                ].map((b) => (
                  <div key={b.label} className="rounded-lg border border-border p-2 print:p-1">
                    <p className="text-[11px] text-muted-foreground">{b.label}</p>
                    <p className={`text-sm font-mono font-semibold ${b.v > 0 && b.label !== "Current" ? "text-destructive" : "text-foreground"}`}>{formatCurrency(b.v)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mt-8 text-xs text-muted-foreground print:mt-6">
            All amounts in LKR. Please remit the closing balance by the due dates shown. Contact us for any discrepancies.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
