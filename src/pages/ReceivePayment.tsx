import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/currency";
import { useCustomers } from "@/hooks/useData";
import { useInvoices } from "@/hooks/useData";
import { useARAccounts, useReceivePaymentWithGL } from "@/hooks/useARModule";

export default function ReceivePayment() {
  const navigate = useNavigate();
  const { data: customers } = useCustomers();
  const { data: invoices } = useInvoices();
  const { data: accounts } = useARAccounts();
  const receivePayment = useReceivePaymentWithGL();

  const [customerId, setCustomerId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [arAccountId, setArAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [selectedInvoices, setSelectedInvoices] = useState<Record<string, number>>({});

  // Auto-select first AR and bank accounts
  useState(() => {
    if (accounts?.arAccounts?.[0]) setArAccountId(accounts.arAccounts[0].id);
    if (accounts?.bankAccounts?.[0]) setBankAccountId(accounts.bankAccounts[0].id);
  });

  const customerInvoices = (invoices || []).filter(
    (i: any) => i.customer_id === customerId && i.balance_due > 0
  );

  const totalPayment = Object.values(selectedInvoices).reduce((s, v) => s + v, 0);

  const handleApply = async () => {
    for (const [invoiceId, amount] of Object.entries(selectedInvoices)) {
      if (amount <= 0) continue;
      await receivePayment.mutateAsync({
        invoice_id: invoiceId,
        customer_id: customerId,
        amount,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        reference,
        bank_account_id: bankAccountId,
        ar_account_id: arAccountId,
      });
    }
    navigate("/accounting/customers/" + customerId);
  };

  const toggleInvoice = (invId: string, balanceDue: number) => {
    setSelectedInvoices((prev) => {
      if (prev[invId] !== undefined) {
        const next = { ...prev };
        delete next[invId];
        return next;
      }
      return { ...prev, [invId]: balanceDue };
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-primary" /> Receive Payment
          </h1>
          <p className="text-sm text-muted-foreground">Apply payments to outstanding invoices</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Payment Details */}
        <Card className="col-span-1">
          <CardHeader><CardTitle>Payment Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Customer *</Label>
              <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setSelectedInvoices({}); }}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {(customers || []).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Payment Date</Label>
              <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="credit_card">Credit Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Deposit To (Bank Account) *</Label>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger><SelectValue placeholder="Select bank account" /></SelectTrigger>
                <SelectContent>
                  {(accounts?.bankAccounts || []).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.account_code} - {a.account_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>AR Account *</Label>
              <Select value={arAccountId} onValueChange={setArAccountId}>
                <SelectTrigger><SelectValue placeholder="Select AR account" /></SelectTrigger>
                <SelectContent>
                  {(accounts?.arAccounts || []).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.account_code} - {a.account_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reference / Check #</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. CHK-001" />
            </div>

            <div className="pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground">Total Payment</p>
              <p className="text-2xl font-bold text-primary tabular-nums">{formatCurrency(totalPayment)}</p>
            </div>

            <Button
              className="w-full"
              onClick={handleApply}
              disabled={!customerId || !bankAccountId || !arAccountId || totalPayment <= 0 || receivePayment.isPending}
            >
              {receivePayment.isPending ? "Processing..." : "Apply Payment"}
            </Button>
          </CardContent>
        </Card>

        {/* Right: Outstanding Invoices */}
        <Card className="col-span-2">
          <CardHeader><CardTitle>Outstanding Invoices</CardTitle></CardHeader>
          <CardContent className="p-0">
            {!customerId ? (
              <p className="text-center py-8 text-muted-foreground">Select a customer to see outstanding invoices</p>
            ) : customerInvoices.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">No outstanding invoices for this customer</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Original</TableHead>
                    <TableHead className="text-right">Balance Due</TableHead>
                    <TableHead className="text-right">Payment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerInvoices.map((inv: any) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedInvoices[inv.id] !== undefined}
                          onCheckedChange={() => toggleInvoice(inv.id, inv.balance_due)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                      <TableCell className="text-muted-foreground">{inv.due_date || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(Number(inv.total_amount))}</TableCell>
                      <TableCell className="text-right tabular-nums text-destructive font-semibold">{formatCurrency(inv.balance_due)}</TableCell>
                      <TableCell className="text-right">
                        {selectedInvoices[inv.id] !== undefined ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="w-28 text-right ml-auto"
                            value={selectedInvoices[inv.id]}
                            onChange={(e) =>
                              setSelectedInvoices((prev) => ({
                                ...prev,
                                [inv.id]: Math.min(Number(e.target.value) || 0, inv.balance_due),
                              }))
                            }
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
