import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, CreditCard, Receipt, User, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/currency";
import { useCustomerDetail } from "@/hooks/useARModule";

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useCustomerDetail(id);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading customer...</div>;
  if (!data) return <div className="p-8 text-muted-foreground">Customer not found</div>;

  const { customer, invoices, payments, creditNotes, arEntries } = data;

  // Derive balance from ar_subledger (SUM debit - credit)
  const arBalance = (arEntries || []).reduce((s: number, e: any) => s + Number(e.debit || 0) - Number(e.credit || 0), 0);
  const totalInvoiced = (arEntries || []).filter((e: any) => e.document_type === "invoice" || e.document_type === "opening_balance").reduce((s: number, e: any) => s + Number(e.debit || 0), 0);
  const totalPaid = (arEntries || []).filter((e: any) => e.document_type === "payment_received").reduce((s: number, e: any) => s + Number(e.credit || 0), 0);
  const totalCredits = (arEntries || []).filter((e: any) => e.document_type === "credit_note").reduce((s: number, e: any) => s + Number(e.credit || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/sales/customers")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <User className="w-6 h-6 text-primary" />
            {customer.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {customer.email && <span>{customer.email} · </span>}
            {customer.phone && <span>{customer.phone} · </span>}
            Terms: {customer.payment_terms?.replace("_", " ") || "Net 30"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/sales/invoices")}>
            <FileText className="w-4 h-4 mr-2" /> New Invoice
          </Button>
          <Button variant="outline" onClick={() => navigate("/accounting/receive-payment")}>
            <CreditCard className="w-4 h-4 mr-2" /> Receive Payment
          </Button>
        </div>
      </div>

      {/* Summary Cards - derived from ar_subledger */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Invoiced</p>
            <p className="text-xl font-bold text-foreground tabular-nums">{formatCurrency(totalInvoiced)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Paid</p>
            <p className="text-xl font-bold text-primary tabular-nums">{formatCurrency(totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Credits</p>
            <p className="text-xl font-bold text-warning tabular-nums">{formatCurrency(totalCredits)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">AR Balance</p>
            <p className={`text-xl font-bold tabular-nums ${arBalance > 0 ? "text-destructive" : "text-primary"}`}>
              {formatCurrency(arBalance)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="ledger">
        <TabsList>
          <TabsTrigger value="ledger"><TrendingUp className="w-4 h-4 mr-1" /> Ledger</TabsTrigger>
          <TabsTrigger value="invoices"><FileText className="w-4 h-4 mr-1" /> Invoices ({invoices.length})</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="w-4 h-4 mr-1" /> Payments ({payments.length})</TabsTrigger>
          <TabsTrigger value="credits"><Receipt className="w-4 h-4 mr-1" /> Credit Notes ({creditNotes.length})</TabsTrigger>
        </TabsList>

        {/* Customer Ledger - derived from ar_subledger */}
        <TabsContent value="ledger">
          <Card>
            <CardHeader><CardTitle>Customer Ledger (AR Subledger)</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Document</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const sorted = [...(arEntries || [])].sort((a: any, b: any) => 
                      (a.created_at || "").localeCompare(b.created_at || "")
                    );

                    if (sorted.length === 0) {
                      return (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No ledger entries</TableCell></TableRow>
                      );
                    }

                    let runningBalance = 0;
                    return sorted.map((entry: any, idx: number) => {
                      const dr = Number(entry.debit || 0);
                      const cr = Number(entry.credit || 0);
                      runningBalance += dr - cr;
                      const docType = (entry.document_type || "").replace("_", " ");
                      return (
                        <TableRow key={entry.id || idx}>
                          <TableCell className="text-muted-foreground">{entry.created_at?.split("T")[0] || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">{docType}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground font-mono text-xs">
                            {entry.invoice_no || entry.document_id?.substring(0, 8) || "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{dr > 0 ? formatCurrency(dr) : ""}</TableCell>
                          <TableCell className="text-right tabular-nums">{cr > 0 ? formatCurrency(cr) : ""}</TableCell>
                          <TableCell className={`text-right tabular-nums font-semibold ${runningBalance > 0 ? "text-destructive" : "text-primary"}`}>
                            {formatCurrency(Math.abs(runningBalance))} {runningBalance < 0 ? "CR" : "DR"}
                          </TableCell>
                        </TableRow>
                      );
                    });
                  })()}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No invoices</TableCell></TableRow>
                  ) : invoices.map((inv: any) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                      <TableCell className="text-muted-foreground">{inv.issue_date}</TableCell>
                      <TableCell className="text-muted-foreground">{inv.due_date || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={inv.balance_due <= 0 ? "default" : "destructive"}>
                          {inv.balance_due <= 0 ? "Paid" : inv.amount_paid > 0 ? "Partial" : inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(Number(inv.total_amount))}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(inv.amount_paid)}</TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${inv.balance_due > 0 ? "text-destructive" : "text-primary"}`}>
                        {formatCurrency(inv.balance_due)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No payments received</TableCell></TableRow>
                  ) : payments.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell>{new Date(p.payment_date).toLocaleDateString()}</TableCell>
                      <TableCell className="capitalize">{p.payment_method?.replace("_", " ") || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{p.reference || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-primary">{formatCurrency(Number(p.amount))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credits">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Credit Note #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creditNotes.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No credit notes</TableCell></TableRow>
                  ) : creditNotes.map((cn: any) => (
                    <TableRow key={cn.id}>
                      <TableCell className="font-medium">{cn.credit_note_number}</TableCell>
                      <TableCell className="text-muted-foreground">{cn.credit_date}</TableCell>
                      <TableCell className="text-muted-foreground">{cn.reason || "—"}</TableCell>
                      <TableCell><Badge variant="outline">{cn.status}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-warning">{formatCurrency(Number(cn.amount))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
