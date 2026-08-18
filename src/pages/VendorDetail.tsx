import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, FileText, CreditCard, Receipt, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/currency";
import { useVendorDetail } from "@/hooks/useAPModule";
import PayBillsDialog from "@/components/ap/PayBillsDialog";
import VendorCreditNoteDialog from "@/components/ap/VendorCreditNoteDialog";
import { formatDate } from "@/lib/format";

function getBillStatus(bill: any): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  const today = new Date();
  const balanceDue = Number(bill.balance_due ?? 0);
  const amountPaid = Number(bill.amount_paid ?? 0);
  const total = Number(bill.total_amount ?? 0);
  const isOverdue = bill.due_date && new Date(bill.due_date) < today && balanceDue > 0.005;

  if (bill.status === "draft") return { label: "Draft", variant: "secondary" };
  if (balanceDue <= 0.005 || bill.status === "paid") return { label: "Paid", variant: "default" };
  if (isOverdue) return { label: "Overdue", variant: "destructive" };
  if (amountPaid > 0 && amountPaid < total) return { label: "Partial", variant: "outline" };
  return { label: "Posted", variant: "outline" };
}

export default function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useVendorDetail(id);
  const [payOpen, setPayOpen] = useState(false);
  const [cnOpen, setCnOpen] = useState(false);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading vendor…</div>;
  if (!data) return <div className="p-8 text-muted-foreground">Vendor not found</div>;

  const { vendor, bills, payments, creditNotes, apEntries } = data;

  // AP balance: sum of (credit - debit) entries — positive = we owe
  const apBalance = (apEntries ?? []).reduce(
    (s: number, e: any) => s + Number(e.credit || 0) - Number(e.debit || 0),
    0
  );
  const totalBilled = (apEntries ?? [])
    .filter((e: any) => e.document_type === "bill" || e.document_type === "opening_balance")
    .reduce((s: number, e: any) => s + Number(e.credit || 0), 0);
  const totalPaid = (apEntries ?? [])
    .filter((e: any) => e.document_type === "bill_payment")
    .reduce((s: number, e: any) => s + Number(e.debit || 0), 0);
  const totalCredits = (apEntries ?? [])
    .filter((e: any) => e.document_type === "vendor_credit")
    .reduce((s: number, e: any) => s + Number(e.debit || 0), 0);

  const openBillsCount = bills.filter((b: any) => b.balance_due > 0.005 && b.status !== "draft").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/accounting/vendors")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary" />
            {vendor.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {vendor.email && <span>{vendor.email} · </span>}
            {vendor.phone && <span>{vendor.phone} · </span>}
            {vendor.address && <span>{vendor.address}</span>}
          </p>
        </div>
        {apBalance > 0.005 && (
          <Badge variant="destructive" className="text-sm px-3 py-1">
            Owed: {formatCurrency(apBalance)}
          </Badge>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setCnOpen(true)}
            disabled={bills.length === 0}
          >
            <Receipt className="w-4 h-4 mr-2" /> New Credit Note
          </Button>
          <Button onClick={() => setPayOpen(true)} disabled={openBillsCount === 0}>
            <CreditCard className="w-4 h-4 mr-2" /> Pay Bills
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Billed</p>
            <p className="text-xl font-bold text-foreground tabular-nums">{formatCurrency(totalBilled)}</p>
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
            <p className="text-xl font-bold tabular-nums" style={{ color: "hsl(var(--warning))" }}>{formatCurrency(totalCredits)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">AP Balance</p>
            <p className={`text-xl font-bold tabular-nums ${apBalance > 0 ? "text-destructive" : "text-primary"}`}>
              {formatCurrency(apBalance)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="bills">
        <TabsList>
          <TabsTrigger value="bills"><FileText className="w-4 h-4 mr-1" /> Bills ({bills.length})</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="w-4 h-4 mr-1" /> Payments ({payments.length})</TabsTrigger>
          <TabsTrigger value="credits"><Receipt className="w-4 h-4 mr-1" /> Credit Notes ({creditNotes.length})</TabsTrigger>
          <TabsTrigger value="ledger"><TrendingUp className="w-4 h-4 mr-1" /> AP Ledger</TabsTrigger>
        </TabsList>

        {/* Bills tab */}
        <TabsContent value="bills">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bill #</TableHead>
                    <TableHead>Bill Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bills.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No bills</TableCell>
                    </TableRow>
                  ) : (
                    bills.map((bill: any) => {
                      const { label, variant } = getBillStatus(bill);
                      return (
                        <TableRow
                          key={bill.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => navigate("/accounting/procurement")}
                        >
                          <TableCell className="font-mono font-medium">{bill.bill_number}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{formatDate(bill.bill_date)}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{bill.due_date || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(Number(bill.total_amount))}</TableCell>
                          <TableCell className="text-right tabular-nums text-primary">{formatCurrency(bill.amount_paid)}</TableCell>
                          <TableCell className={`text-right tabular-nums font-semibold ${bill.balance_due > 0.005 ? "text-destructive" : "text-primary"}`}>
                            {formatCurrency(bill.balance_due)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={variant}>{label}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                  {bills.length > 0 && (
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell colSpan={5} className="text-right">Total Outstanding:</TableCell>
                      <TableCell className="text-right tabular-nums text-destructive">
                        {formatCurrency(bills.reduce((s: number, b: any) => s + b.balance_due, 0))}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payments tab */}
        <TabsContent value="payments">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Bank Account</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Journal Entry</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No payments recorded</TableCell>
                    </TableRow>
                  ) : (
                    payments.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-muted-foreground">{formatDate(p.payment_date)}</TableCell>
                        <TableCell className="text-muted-foreground">{p.reference || "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{p.bank_account_id?.substring(0, 8)}…</TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-primary">
                          {formatCurrency(Number(p.amount))}
                        </TableCell>
                        <TableCell>
                          {p.journal_entry_id ? (
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={() => navigate(`/accounting/journals/${p.journal_entry_id}`)}
                            >
                              View JE
                            </Button>
                          ) : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Credit Notes tab */}
        <TabsContent value="credits">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Vendor Credit Notes</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setCnOpen(true)}>
                <Receipt className="w-4 h-4 mr-1" /> New Credit Note
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Credit Note #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creditNotes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No credit notes</TableCell>
                    </TableRow>
                  ) : (
                    creditNotes.map((cn: any) => (
                      <TableRow key={cn.id}>
                        <TableCell className="font-mono font-medium">{cn.credit_note_number}</TableCell>
                        <TableCell className="text-muted-foreground">{cn.credit_date}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium" style={{ color: "hsl(var(--warning))" }}>
                          {formatCurrency(Number(cn.amount))}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{cn.reason || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={cn.status === "posted" ? "default" : "secondary"}>
                            {cn.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AP Ledger tab */}
        <TabsContent value="ledger">
          <Card>
            <CardHeader><CardTitle>AP Subledger</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Running Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const sorted = [...(apEntries ?? [])].sort((a: any, b: any) =>
                      (a.created_at || "").localeCompare(b.created_at || "")
                    );
                    if (sorted.length === 0) {
                      return (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            No ledger entries
                          </TableCell>
                        </TableRow>
                      );
                    }
                    let runningBalance = 0;
                    return sorted.map((entry: any, idx: number) => {
                      const dr = Number(entry.debit || 0);
                      const cr = Number(entry.credit || 0);
                      // AP: credit = bill (increases liability), debit = payment (decreases liability)
                      runningBalance += cr - dr;
                      const docType = (entry.document_type || "").replace(/_/g, " ");
                      return (
                        <TableRow key={entry.id || idx}>
                          <TableCell className="text-muted-foreground text-sm">
                            {entry.created_at?.split("T")[0] || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize text-xs">{docType}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground font-mono text-xs">
                            {entry.bill_no || entry.document_id?.substring(0, 8) || "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {dr > 0 ? formatCurrency(dr) : ""}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {cr > 0 ? formatCurrency(cr) : ""}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums font-semibold ${runningBalance > 0 ? "text-destructive" : "text-primary"}`}>
                            {formatCurrency(Math.abs(runningBalance))} {runningBalance > 0 ? "CR" : "DR"}
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
      </Tabs>

      {/* Dialogs */}
      {payOpen && (
        <PayBillsDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          vendorId={vendor.id}
          vendorName={vendor.name}
        />
      )}
      {cnOpen && (
        <VendorCreditNoteDialog
          open={cnOpen}
          onOpenChange={setCnOpen}
          vendorId={vendor.id}
          vendorName={vendor.name}
        />
      )}
    </div>
  );
}
