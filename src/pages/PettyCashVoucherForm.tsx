import { useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2, Save, Upload, X } from "lucide-react";
import BudgetWarningBanner from "@/components/budgets/BudgetWarningBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  usePettyCashAccounts,
  useExpenseAccounts,
  useTenantUsers,
  useGenerateVoucherNumber,
  useCreatePCVoucher,
  useUploadReceipt,
} from "@/hooks/usePettyCash";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";
import { useEffect } from "react";

interface VoucherLine {
  date: string;
  description: string;
  account_id: string;
  amount: number;
}

export default function PettyCashVoucherForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedAccount = searchParams.get("account") || "";

  const { data: pcAccounts } = usePettyCashAccounts();
  const { data: expenseAccounts } = useExpenseAccounts();
  const { data: users } = useTenantUsers();
  const { data: voucherNumber } = useGenerateVoucherNumber();
  const createVoucher = useCreatePCVoucher();
  const uploadReceipt = useUploadReceipt();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const today = new Date().toISOString().split("T")[0];

  const [date, setDate] = useState(today);
  const [paidTo, setPaidTo] = useState("");
  const [pcAccountId, setPcAccountId] = useState(preselectedAccount);
  const [authorizedBy, setAuthorizedBy] = useState("");
  const [receiptPaths, setReceiptPaths] = useState<string[]>([]);
  const [lines, setLines] = useState<VoucherLine[]>([
    { date: today, description: "", account_id: "", amount: 0 },
  ]);

  useEffect(() => {
    if (preselectedAccount) setPcAccountId(preselectedAccount);
  }, [preselectedAccount]);

  const total = lines.reduce((s, l) => s + l.amount, 0);

  const addLine = () => setLines([...lines, { date: today, description: "", account_id: "", amount: 0 }]);
  const removeLine = (idx: number) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== idx));
  };
  const updateLine = (idx: number, field: keyof VoucherLine, value: any) => {
    const updated = [...lines];
    (updated[idx] as any)[field] = field === "amount" ? Number(value) : value;
    setLines(updated);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        const path = await uploadReceipt.mutateAsync({ file });
        setReceiptPaths((prev) => [...prev, path]);
        toast.success(`Uploaded ${file.name}`);
      } catch { /* error already toasted */ }
    }
    e.target.value = "";
  };

  const removeReceipt = (idx: number) => {
    setReceiptPaths((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = () => {
    if (!pcAccountId) return toast.error("Select a petty cash account");
    if (!voucherNumber) return toast.error("Voucher number not generated");
    if (lines.some((l) => !l.account_id || l.amount <= 0)) {
      return toast.error("All lines must have an account and amount > 0");
    }
    if (total <= 0) return toast.error("Total must be greater than 0");

    createVoucher.mutate(
      {
        voucher_number: voucherNumber,
        date,
        paid_to: paidTo,
        petty_cash_account_id: pcAccountId,
        authorized_by: authorizedBy || undefined,
        receipt_urls: receiptPaths,
        lines,
      },
      { onSuccess: () => navigate("/banking/petty-cash") }
    );
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">New Petty Cash Voucher</h1>
          <p className="page-description">Record petty cash expenses</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-mono">{voucherNumber || "Generating..."}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Header fields */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Paid To</Label>
              <Input value={paidTo} onChange={(e) => setPaidTo(e.target.value)} placeholder="Recipient name" />
            </div>
            <div>
              <Label>Petty Cash Account</Label>
              <Select value={pcAccountId} onValueChange={setPcAccountId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {pcAccounts?.filter((a) => a.is_active).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Authorized By</Label>
              <Select value={authorizedBy} onValueChange={setAuthorizedBy}>
                <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>
                  {users?.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.first_name} {u.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Lines table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold">Voucher Lines</Label>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="w-3 h-3 mr-1" /> Add Line
              </Button>
            </div>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-3 py-2 text-left w-12">S.No</th>
                    <th className="px-3 py-2 text-left w-32">Date</th>
                    <th className="px-3 py-2 text-left">Description</th>
                    <th className="px-3 py-2 text-left w-56">Account</th>
                    <th className="px-3 py-2 text-right w-32">Amount</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                      <td className="px-3 py-1">
                        <Input type="date" value={line.date} onChange={(e) => updateLine(idx, "date", e.target.value)} className="h-8 text-xs" />
                      </td>
                      <td className="px-3 py-1">
                        <Input value={line.description} onChange={(e) => updateLine(idx, "description", e.target.value)} placeholder="Description" className="h-8 text-xs" />
                      </td>
                      <td className="px-3 py-1">
                        <Select value={line.account_id} onValueChange={(v) => updateLine(idx, "account_id", v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select account" /></SelectTrigger>
                          <SelectContent>
                            {expenseAccounts?.map((a) => (
                              <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-1">
                        <Input type="number" value={line.amount || ""} onChange={(e) => updateLine(idx, "amount", e.target.value)} className="h-8 text-xs text-right" min={0} step="0.01" />
                      </td>
                      <td className="px-3 py-1 text-center">
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/50">
                    <td colSpan={4} className="px-3 py-2 text-right font-semibold">Total</td>
                    <td className="px-3 py-2 text-right font-bold">{formatCurrency(total)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Receipt attachments */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold">Receipt Attachments</Label>
              <div>
                <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple className="hidden" onChange={handleFileUpload} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadReceipt.isPending}>
                  <Upload className="w-3 h-3 mr-1" /> {uploadReceipt.isPending ? "Uploading..." : "Upload"}
                </Button>
              </div>
            </div>
            {receiptPaths.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {receiptPaths.map((path, idx) => (
                  <div key={idx} className="flex items-center gap-1 px-2 py-1 bg-muted rounded text-xs">
                    <span>Receipt {idx + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-4 w-4" onClick={() => removeReceipt(idx)}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              Prepared by: <span className="font-medium text-foreground">Current User</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate("/banking/petty-cash")}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={createVoucher.isPending}>
                <Save className="w-4 h-4 mr-1" /> {createVoucher.isPending ? "Saving..." : "Save Voucher"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
