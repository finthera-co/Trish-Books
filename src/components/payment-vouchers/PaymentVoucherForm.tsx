import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Plus, Trash2, AlertCircle, ChevronDown } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import BudgetWarningBanner from "@/components/budgets/BudgetWarningBanner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useAccounts, useCustomers } from "@/hooks/useData";
import { useAccountBalances } from "@/hooks/useData";
import { useVendorsWithBalance } from "@/hooks/useSubledgerData";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCreatePaymentVoucher,
  useUpdatePaymentVoucher,
  usePaymentVoucher,
  VoucherLine,
} from "@/hooks/usePaymentVouchers";
import AccountSelector from "@/components/shared/AccountSelector";
import AccountCombobox from "@/components/shared/AccountCombobox";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";
import { PAYMENT_METHODS } from "@/lib/paymentMethods";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { useCostCenters, useLocations } from "@/hooks/useDimensions";
import { useHideSidebar, useSetHideSidebar } from "@/stores/useAppStore";

// Account-type rules — must mirror the server-side `create_payment_voucher` RPC.
const LINE_ACCOUNT_TYPES = ["Expense", "Cost of Goods Sold", "Other Expense", "Liability"];
const PAYMENT_ACCOUNT_TYPES = ["Asset"];

interface Props {
  editId: string | null;
  onClose: () => void;
  /**
   * Deep-linked from an account's context menu ("Quick Create → Make
   * Payment"). Seeds the "pay from" bank account when it's an Asset, or
   * line 1's expense/liability account otherwise — whichever side of
   * PAYMENT_ACCOUNT_TYPES / LINE_ACCOUNT_TYPES it falls on. Ignored when
   * editing an existing check.
   */
  initialAccountId?: string | null;
}

function buildAddressBlock(addr: {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country?: string | null;
} | null): string {
  if (!addr) return "";
  const cityLine = [addr.city, addr.state_province, addr.postal_code].filter(Boolean).join(", ");
  return [addr.address_line1, addr.address_line2, cityLine, addr.country].filter(Boolean).join("\n");
}

export default function PaymentVoucherForm({ editId, onClose, initialAccountId }: Props) {
  const { appUser } = useAuth();
  const { data: customers } = useCustomers();
  const { data: vendors } = useVendorsWithBalance();
  const { data: accounts } = useAccounts();
  const { data: acctBalances } = useAccountBalances();
  const { data: existing } = usePaymentVoucher(editId || undefined);
  const createMutation = useCreatePaymentVoucher();
  const updateMutation = useUpdatePaymentVoucher();
  const { data: accountSettings } = useAccountSettings();
  const { data: costCenters } = useCostCenters();
  const { data: locations } = useLocations();
  const classTrackingEnabled = !!accountSettings?.class_tracking_enabled;
  const locationTrackingEnabled = !!accountSettings?.location_tracking_enabled;
  const locationLabel = accountSettings?.location_label || "Location";

  // Collapse the module nav panel while writing a check — the same reasoning
  // as Enter Bill: this form is wide and benefits from the extra room.
  // Restores whatever the sidebar's prior state was on unmount.
  const sidebarHidden = useHideSidebar();
  const setSidebarHidden = useSetHideSidebar();
  useEffect(() => {
    const prev = sidebarHidden;
    setSidebarHidden(true);
    return () => setSidebarHidden(prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bankAccounts = useMemo(() =>
    (accounts as any[] ?? []).filter((a) =>
      a.is_active &&
      a.account_type === "Asset" &&
      (a.account_subtype?.toLowerCase().includes("cash") ||
        a.account_subtype?.toLowerCase().includes("bank") ||
        a.account_subtype?.toLowerCase().includes("checking") ||
        a.account_subtype?.toLowerCase().includes("savings"))
    ),
    [accounts]
  );

  const [accountNumber, setAccountNumber] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [payeeType, setPayeeType] = useState<"vendor" | "customer">("vendor");
  const [payeeId, setPayeeId] = useState("");
  const [payeeVendorId, setPayeeVendorId] = useState("");
  const [permitNo, setPermitNo] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [memo, setMemo] = useState("");
  const [billsAttached, setBillsAttached] = useState(0);
  const [approvedBy, setApprovedBy] = useState("");
  const [accountant, setAccountant] = useState("");
  const [checkedBy, setCheckedBy] = useState("");
  const [madeBy, setMadeBy] = useState("");
  const [printLater, setPrintLater] = useState(false);
  const [addressBlock, setAddressBlock] = useState("");
  const [locationId, setLocationId] = useState("");
  const [lines, setLines] = useState<VoucherLine[]>([{ account_id: "", description: "", amount: 0, customer_id: null, is_billable: false, cost_center_id: null }]);
  const [showConfirm, setShowConfirm] = useState(false);

  const isPosted = existing?.status === "posted";
  const isEditing = !!editId;

  const bankBalance = useMemo(() => {
    const row = (acctBalances ?? []).find((a: any) => a.account_id === paymentAccountId);
    return row ? row.debit - row.credit : 0;
  }, [acctBalances, paymentAccountId]);

  // Preview the next check number for a brand-new check (server assigns the
  // real voucher_number; this only prefills the editable "No." field).
  useEffect(() => {
    if (isEditing || !appUser?.tenant_id) return;
    let cancelled = false;
    supabase
      .from("payment_vouchers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", appUser.tenant_id)
      .then(({ count }) => {
        if (cancelled) return;
        setChequeNumber((prev) => (prev ? prev : `CHK-${String((count ?? 0) + 1).padStart(5, "0")}`));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, appUser?.tenant_id]);

  useEffect(() => {
    if (existing && editId) {
      setAccountNumber(existing.account_number || "");
      setChequeNumber(existing.cheque_number || "");
      setPayeeId(existing.payee_id || "");
      setPayeeVendorId((existing as any).payee_vendor_id || "");
      setPayeeType((existing as any).payee_vendor_id ? "vendor" : "customer");
      setPermitNo((existing as any).permit_no || "");
      setPaymentAccountId(existing.payment_account_id);
      setPaymentMethod(existing.payment_method);
      setReferenceNumber(existing.reference_number || "");
      setPaymentDate(new Date(existing.payment_date));
      setMemo(existing.memo || "");
      setBillsAttached(existing.bills_attached || 0);
      setApprovedBy(existing.approved_by || "");
      setAccountant(existing.accountant || "");
      setCheckedBy(existing.checked_by || "");
      setMadeBy(existing.made_by || "");
      setPrintLater(existing.print_later || false);
      setAddressBlock(existing.address_block || "");
      setLocationId((existing as any).location_id || "");
      const ln = (existing as { payment_voucher_lines?: Array<{ id: string; account_id: string; description: string | null; amount: number; customer_id: string | null; is_billable: boolean; cost_center_id: string | null }> }).payment_voucher_lines;
      if (ln?.length) {
        setLines(
          ln.map((l) => ({
            id: l.id,
            account_id: l.account_id,
            description: l.description || "",
            amount: Number(l.amount),
            customer_id: l.customer_id,
            is_billable: l.is_billable,
            cost_center_id: l.cost_center_id,
          }))
        );
      }
    }
  }, [existing, editId]);

  useEffect(() => {
    if (isEditing || !initialAccountId || !accounts) return;
    const acct = (accounts as any[]).find((a) => a.id === initialAccountId);
    if (!acct) return;
    if (PAYMENT_ACCOUNT_TYPES.includes(acct.account_type)) {
      setPaymentAccountId((prev) => prev || initialAccountId);
    } else if (LINE_ACCOUNT_TYPES.includes(acct.account_type)) {
      setLines((prev) => (prev.length === 1 && !prev[0].account_id ? [{ ...prev[0], account_id: initialAccountId }] : prev));
    }
  }, [isEditing, initialAccountId, accounts]);

  // Address auto-populates from the selected payee. Vendors only have a flat
  // `address` column; customers have a dedicated primary-billing-address
  // table we prefer when present. Only while creating, or while still
  // editing a draft — posted vouchers just display what was saved at post
  // time.
  useEffect(() => {
    if (isPosted) return;

    if (payeeType === "vendor") {
      if (!payeeVendorId) { setAddressBlock(""); return; }
      const vendor = (vendors ?? []).find((v: any) => v.id === payeeVendorId);
      setAddressBlock((vendor as any)?.address || "");
      return;
    }

    if (!payeeId) { setAddressBlock(""); return; }
    let cancelled = false;
    supabase
      .from("customer_addresses")
      .select("address_line1, address_line2, city, state_province, postal_code, country")
      .eq("customer_id", payeeId)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          setAddressBlock(buildAddressBlock(data));
        } else {
          const customer = customers?.find((c) => c.id === payeeId);
          setAddressBlock((customer as { address?: string | null } | undefined)?.address || "");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [payeeId, payeeVendorId, payeeType, isPosted, customers, vendors]);

  // Server rounds to 2dp; mirror that for display.
  const totalAmount = useMemo(
    () => Math.round(lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0) * 100) / 100,
    [lines]
  );

  // ----- Validation (mirrors server rules so submit is gated client-side too) -----
  const errors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!paymentAccountId) errs.paymentAccount = "Bank account is required";
    if (!paymentDate) errs.paymentDate = "Date is required";
    if (lines.length === 0) errs.lines = "At least one line is required";

    lines.forEach((l, idx) => {
      if (!l.account_id) errs[`line-${idx}-account`] = "Account is required";
      if (l.account_id && l.account_id === paymentAccountId)
        errs[`line-${idx}-account`] = "Cannot match the bank account";
      const amt = Number(l.amount);
      if (!amt || amt <= 0) errs[`line-${idx}-amount`] = "Amount must be > 0";
      if (amt && Math.round(amt * 100) / 100 !== amt)
        errs[`line-${idx}-amount`] = "Max 2 decimal places";
      if (l.is_billable && !l.customer_id)
        errs[`line-${idx}-billable`] = "Billable requires a Customer:Job";
    });

    if (totalAmount <= 0) errs.total = "Total must be greater than zero";
    return errs;
  }, [paymentAccountId, paymentDate, lines, totalAmount]);

  const isValid = Object.keys(errors).length === 0;

  const addLine = () => setLines([...lines, { account_id: "", description: "", amount: 0, customer_id: null, is_billable: false, cost_center_id: null }]);

  const removeLine = (idx: number) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: keyof VoucherLine, value: string | number | boolean | null) => {
    setLines(
      lines.map((l, i) => {
        if (i !== idx) return l;
        const next = { ...l, [field]: value } as VoucherLine;
        if (field === "customer_id" && !value) next.is_billable = false;
        return next;
      })
    );
  };

  const handleAttemptSubmit = () => {
    if (!isValid) {
      const first = Object.values(errors)[0];
      toast.error(first || "Please fix validation errors");
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirmedSubmit = () => {
    setShowConfirm(false);
    const formData = {
      account_number: accountNumber,
      cheque_number: chequeNumber,
      payee_id: payeeId || undefined,
      payment_account_id: paymentAccountId,
      payment_method: paymentMethod,
      reference_number: referenceNumber,
      payment_date: format(paymentDate, "yyyy-MM-dd"),
      memo,
      bills_attached: billsAttached,
      approved_by: approvedBy,
      accountant,
      checked_by: checkedBy,
      made_by: madeBy,
      print_later: printLater,
      address_block: addressBlock,
      location_id: locationId || null,
      lines: lines.map((l) => ({
        ...l,
        amount: Math.round(Number(l.amount) * 100) / 100,
        customer_id: l.customer_id || null,
        is_billable: l.is_billable ?? false,
        cost_center_id: l.cost_center_id || null,
      })),
    };

    if (editId) {
      updateMutation.mutate({ id: editId, ...formData }, { onSuccess: onClose });
    } else {
      createMutation.mutate(formData, { onSuccess: onClose });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      {isPosted && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 text-warning shrink-0" />
          <div>
            This check is <strong>posted</strong> and immutable. Create a reversal to make adjustments.
          </div>
        </div>
      )}

      {/* Check face */}
      <Card className="border-2 bg-muted/30">
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Bank Account *</Label>
              <AccountSelector
                value={paymentAccountId}
                onChange={(v) => setPaymentAccountId(v)}
                types={PAYMENT_ACCOUNT_TYPES}
                placeholder="Search cash / bank account…"
                disabled={isPosted}
              />
              <p className="text-xs text-muted-foreground mt-1">Cash or Bank assets only</p>
            </div>
            <div>
              <Label>No.</Label>
              <Input
                value={chequeNumber}
                onChange={(e) => setChequeNumber(e.target.value)}
                placeholder="CHK-00001"
                className="font-mono"
                disabled={isPosted}
              />
            </div>
            <div>
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={isPosted}
                    className={cn("w-full justify-start text-left font-normal", !paymentDate && "text-muted-foreground")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {paymentDate ? formatDate(paymentDate) : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={paymentDate} onSelect={(d) => d && setPaymentDate(d)} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label>Pay to the Order of</Label>
              <Select value={payeeId} onValueChange={setPayeeId} disabled={isPosted}>
                <SelectTrigger><SelectValue placeholder="Select payee" /></SelectTrigger>
                <SelectContent>
                  {customers?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod} disabled={isPosted}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {locationTrackingEnabled ? (
              <div>
                <Label>{locationLabel}</Label>
                <Select value={locationId || "__none__"} onValueChange={(v) => setLocationId(v === "__none__" ? "" : v)} disabled={isPosted}>
                  <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not set</SelectItem>
                    {(locations ?? []).map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div />
            )}

            <div>
              <Label>Address</Label>
              <Textarea value={addressBlock} readOnly rows={3} className="resize-none bg-muted/50 text-sm" placeholder="Auto-filled from payee" />
            </div>
            <div className="md:col-span-2">
              <Label>Memo</Label>
              <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional notes — prints on the check stub" rows={3} disabled={isPosted} />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox id="print-later" checked={printLater} onCheckedChange={(v) => setPrintLater(!!v)} />
              <Label htmlFor="print-later" className="cursor-pointer font-normal">Print Later</Label>
            </div>
            <div className="md:col-start-3 text-right">
              <Label className="block">Amount</Label>
              <div className="font-mono font-bold text-xl">{formatCurrency(totalAmount)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Expenses register */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-base font-semibold">Expenses</Label>
          <Button variant="outline" size="sm" onClick={addLine} disabled={isPosted}>
            <Plus className="w-4 h-4 mr-1" /> Add Line
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[22%]">Account</TableHead>
              <TableHead className="w-[12%] text-right">Amount</TableHead>
              <TableHead className="w-[20%]">Memo</TableHead>
              <TableHead className="w-[16%]">Customer:Job</TableHead>
              <TableHead className="w-[9%] text-center">Billable?</TableHead>
              {classTrackingEnabled && <TableHead className="w-[15%]">Class</TableHead>}
              <TableHead className="w-[6%]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, idx) => {
              const accErr = errors[`line-${idx}-account`];
              const amtErr = errors[`line-${idx}-amount`];
              const rowInvalid = !!accErr || !!amtErr;
              return (
                <TableRow key={idx} className={rowInvalid ? "bg-destructive/5" : undefined}>
                  <TableCell>
                    <AccountSelector
                      value={line.account_id}
                      onChange={(v) => updateLine(idx, "account_id", v)}
                      types={LINE_ACCOUNT_TYPES}
                      placeholder="Search expense / liability…"
                      disabled={isPosted}
                    />
                    {accErr && <p className="text-xs text-destructive mt-1">{accErr}</p>}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      className="text-right"
                      value={line.amount || ""}
                      onChange={(e) => updateLine(idx, "amount", parseFloat(e.target.value) || 0)}
                      disabled={isPosted}
                    />
                    {amtErr && <p className="text-xs text-destructive mt-1">{amtErr}</p>}
                  </TableCell>
                  <TableCell>
                    <Input
                      value={line.description}
                      onChange={(e) => updateLine(idx, "description", e.target.value)}
                      placeholder="Description"
                      disabled={isPosted}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={line.customer_id || "__none__"}
                      onValueChange={(v) => updateLine(idx, "customer_id", v === "__none__" ? null : v)}
                      disabled={isPosted}
                    >
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {customers?.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={line.is_billable || false}
                      onCheckedChange={(v) => updateLine(idx, "is_billable", !!v)}
                      disabled={isPosted || !line.customer_id}
                    />
                  </TableCell>
                  {classTrackingEnabled && (
                    <TableCell>
                      <Select
                        value={line.cost_center_id || "__none__"}
                        onValueChange={(v) => updateLine(idx, "cost_center_id", v === "__none__" ? null : v)}
                        disabled={isPosted}
                      >
                        <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {costCenters?.map((cc) => (
                            <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length <= 1 || isPosted}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell colSpan={3} className="text-right font-semibold">Check Total:</TableCell>
              <TableCell colSpan={classTrackingEnabled ? 4 : 3} className="text-right font-mono font-bold text-lg">{formatCurrency(totalAmount)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {/* Budget Warnings */}
      {lines.filter((l) => l.account_id && l.amount > 0).map((line, idx) => (
        <BudgetWarningBanner
          key={`budget-pv-${idx}-${line.account_id}`}
          accountId={line.account_id}
          amount={line.amount}
          transactionDate={format(paymentDate, "yyyy-MM-dd")}
        />
      ))}

      {/* Additional details (existing fields, kept for continuity) */}
      <div>
        <Label className="text-base font-semibold mb-2 block">Additional Details</Label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">Account Number</Label>
            <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} disabled={isPosted} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Reference Number</Label>
            <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Must be unique" disabled={isPosted} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Bills Attached</Label>
            <Input type="number" min={0} value={billsAttached} onChange={(e) => setBillsAttached(parseInt(e.target.value) || 0)} disabled={isPosted} />
          </div>
        </div>
      </div>

      <div>
        <Label className="text-base font-semibold mb-2 block">Approval Details</Label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">Made By</Label>
            <Input value={madeBy} onChange={(e) => setMadeBy(e.target.value)} disabled={isPosted} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Checked By</Label>
            <Input value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} disabled={isPosted} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Accountant</Label>
            <Input value={accountant} onChange={(e) => setAccountant(e.target.value)} disabled={isPosted} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Approved By</Label>
            <Input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} disabled={isPosted} />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleAttemptSubmit} disabled={isPending || !isValid || isPosted}>
          {isPending ? "Saving..." : editId ? "Save" : "Save & Close"}
        </Button>
      </div>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post Check?</AlertDialogTitle>
            <AlertDialogDescription>
              Total <strong>{formatCurrency(totalAmount)}</strong> will be posted to the ledger as a balanced
              journal entry. Once posted, this check becomes immutable — only a reversal can adjust it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmedSubmit}>Post Check</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
