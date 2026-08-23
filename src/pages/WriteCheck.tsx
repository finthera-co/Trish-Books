import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import { format } from "date-fns";
import { toast } from "sonner";
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
import BudgetWarningBanner from "@/components/budgets/BudgetWarningBanner";
import CheckTitleBar from "@/components/checks/CheckTitleBar";
import CheckHeaderSection from "@/components/checks/CheckHeaderSection";
import CheckCategoryLines from "@/components/checks/CheckCategoryLines";
import CheckMemoAttachments from "@/components/checks/CheckMemoAttachments";
import CheckActionBar from "@/components/checks/CheckActionBar";
import CheckAuditHistorySheet from "@/components/checks/CheckAuditHistorySheet";
import CheckRecurringDialog from "@/components/checks/CheckRecurringDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAccounts, useCustomers, useAccountBalances } from "@/hooks/useData";
import { useVendorsWithBalance } from "@/hooks/useSubledgerData";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { useCostCenters, useLocations } from "@/hooks/useDimensions";
import { useHideSidebar, useSetHideSidebar } from "@/stores/useAppStore";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useCreateCheck, useVoidCheck, usePaymentVoucher, VoucherLine } from "@/hooks/usePaymentVouchers";
import { formatCurrency } from "@/lib/currency";
import { printCheckPdf } from "@/lib/checkPdf";

const PAYMENT_ACCOUNT_TYPES = ["Asset"];
const LINE_ACCOUNT_TYPES = ["Expense", "Cost of Goods Sold", "Other Expense", "Liability"];

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

const blankLine = (): VoucherLine => ({
  account_id: "", description: "", amount: 0, customer_id: null, is_billable: false, cost_center_id: null, is_taxable: false,
});

export default function WriteCheck() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const { data: customers } = useCustomers();
  const { data: vendors } = useVendorsWithBalance();
  const { data: accounts } = useAccounts();
  const { data: acctBalances } = useAccountBalances();
  const { data: existing } = usePaymentVoucher(id);
  const { data: accountSettings } = useAccountSettings();
  const { data: costCenters } = useCostCenters();
  const { data: locations } = useLocations();
  const { appUser } = useAuth();
  const createMutation = useCreateCheck();
  const voidMutation = useVoidCheck();

  const classTrackingEnabled = !!accountSettings?.class_tracking_enabled;
  const locationTrackingEnabled = !!accountSettings?.location_tracking_enabled;
  const locationLabel = accountSettings?.location_label || "Location";

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

  const [chequeNumber, setChequeNumber] = useState("");
  const [payeeType, setPayeeType] = useState<"vendor" | "customer">("vendor");
  const [payeeId, setPayeeId] = useState("");
  const [payeeVendorId, setPayeeVendorId] = useState("");
  const [permitNumber, setPermitNumber] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentMethod] = useState("Cheque");
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [memo, setMemo] = useState("");
  const [printLater, setPrintLater] = useState(false);
  const [mailingAddress, setMailingAddress] = useState("");
  const [locationId, setLocationId] = useState("");
  const [lines, setLines] = useState<VoucherLine[]>([blankLine()]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saveAndNew, setSaveAndNew] = useState(false);
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [showAuditHistory, setShowAuditHistory] = useState(false);
  const [showRecurringDialog, setShowRecurringDialog] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  const isPosted = !isNew && existing?.status && existing.status !== "draft";
  const isVoided = existing?.status === "voided";
  const disabled = isPosted; // posted/voided checks are read-only

  const bankBalance = useMemo(() => {
    const row = (acctBalances ?? []).find((a: any) => a.account_id === paymentAccountId);
    return row ? row.debit - row.credit : 0;
  }, [acctBalances, paymentAccountId]);

  // Hydrate from an existing check (view mode).
  useEffect(() => {
    if (!existing || isNew) return;
    setChequeNumber(existing.cheque_number || "");
    setPayeeId(existing.payee_id || "");
    setPayeeVendorId((existing as any).payee_vendor_id || "");
    setPayeeType((existing as any).payee_vendor_id ? "vendor" : "customer");
    setPermitNumber((existing as any).permit_number || "");
    setPaymentAccountId(existing.payment_account_id);
    setPaymentDate(new Date(existing.payment_date));
    setMemo(existing.memo || "");
    setPrintLater(existing.print_later || false);
    setMailingAddress((existing as any).mailing_address || "");
    setLocationId((existing as any).location_id || "");
    const ln = (existing as any).payment_voucher_lines as Array<{
      id: string; account_id: string; description: string | null; amount: number;
      customer_id: string | null; is_billable: boolean; cost_center_id: string | null; is_taxable?: boolean;
    }> | undefined;
    if (ln?.length) {
      setLines(ln.map((l) => ({
        id: l.id, account_id: l.account_id, description: l.description || "", amount: Number(l.amount),
        customer_id: l.customer_id, is_billable: l.is_billable, cost_center_id: l.cost_center_id,
        is_taxable: l.is_taxable ?? false,
      })));
    }
  }, [existing, isNew]);

  // Prefill from a deep link (?from_account=) or a whole-document copy.
  useEffect(() => {
    if (!isNew) return;
    const copyFrom = (location.state as { copyFrom?: any } | null)?.copyFrom;
    if (copyFrom) {
      setPayeeId(copyFrom.payee_id || "");
      setPayeeVendorId(copyFrom.payee_vendor_id || "");
      setPayeeType(copyFrom.payee_vendor_id ? "vendor" : "customer");
      setPermitNumber(copyFrom.permit_number || "");
      setPaymentAccountId(copyFrom.payment_account_id || "");
      setMemo(copyFrom.memo || "");
      setMailingAddress(copyFrom.mailing_address || "");
      setLocationId(copyFrom.location_id || "");
      if (copyFrom.lines?.length) setLines(copyFrom.lines.map((l: VoucherLine) => ({ ...l, id: undefined })));
      return;
    }
    const fromAccount = searchParams.get("from_account");
    if (!fromAccount || !accounts) return;
    const acct = (accounts as any[]).find((a) => a.id === fromAccount);
    if (!acct) return;
    if (PAYMENT_ACCOUNT_TYPES.includes(acct.account_type)) {
      setPaymentAccountId((prev) => prev || fromAccount);
    } else if (LINE_ACCOUNT_TYPES.includes(acct.account_type)) {
      setLines((prev) => (prev.length === 1 && !prev[0].account_id ? [{ ...prev[0], account_id: fromAccount }] : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, accounts]);

  // Address auto-fill from the selected payee.
  useEffect(() => {
    if (!isNew) return;

    if (payeeType === "vendor") {
      if (!payeeVendorId) { setMailingAddress(""); return; }
      const vendor = (vendors ?? []).find((v: any) => v.id === payeeVendorId);
      setMailingAddress((vendor as any)?.address || "");
      return;
    }

    if (!payeeId) { setMailingAddress(""); return; }
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
          setMailingAddress(buildAddressBlock(data));
        } else {
          const customer = customers?.find((c) => c.id === payeeId);
          setMailingAddress((customer as { address?: string | null } | undefined)?.address || "");
        }
      });
    return () => { cancelled = true; };
  }, [payeeId, payeeVendorId, payeeType, isNew, customers, vendors]);

  const totalAmount = useMemo(
    () => Math.round(lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0) * 100) / 100,
    [lines]
  );

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

  const resetForm = () => {
    setChequeNumber(""); setPayeeId(""); setPayeeVendorId(""); setPermitNumber("");
    setPaymentAccountId(""); setPaymentDate(new Date()); setMemo(""); setPrintLater(false);
    setMailingAddress(""); setLocationId(""); setLines([blankLine()]);
  };

  const handleAttemptSave = (goNew: boolean) => {
    if (!isValid) {
      toast.error(Object.values(errors)[0] || "Please fix validation errors");
      return;
    }
    setSaveAndNew(goNew);
    setShowConfirm(true);
  };

  const handleConfirmedSave = () => {
    setShowConfirm(false);
    createMutation.mutate(
      {
        cheque_number: chequeNumber || undefined,
        payee_id: payeeType === "customer" ? (payeeId || undefined) : undefined,
        payee_vendor_id: payeeType === "vendor" ? (payeeVendorId || undefined) : undefined,
        permit_number: permitNumber || undefined,
        payment_account_id: paymentAccountId,
        payment_method: paymentMethod,
        payment_date: format(paymentDate, "yyyy-MM-dd"),
        memo,
        print_later: printLater,
        mailing_address: mailingAddress,
        location_id: locationId || null,
        lines: lines.map((l, idx) => ({
          ...l,
          amount: Math.round(Number(l.amount) * 100) / 100,
          customer_id: l.customer_id || null,
          is_billable: l.is_billable ?? false,
          cost_center_id: l.cost_center_id || null,
          is_taxable: l.is_taxable ?? false,
          sort_order: idx,
        })),
      },
      {
        onSuccess: (newId) => {
          if (saveAndNew) {
            resetForm();
            navigate("/checks/new", { replace: true });
          } else {
            navigate(`/checks/${newId}`, { replace: true });
          }
        },
      }
    );
  };

  const handleVoid = async () => {
    if (!id) return;
    await voidMutation.mutateAsync({ id, reason: voidReason.trim() || undefined });
    setShowVoidConfirm(false);
    setVoidReason("");
  };

  const handlePrint = async () => {
    if (!existing || !appUser?.tenant_id) return;
    setIsPrinting(true);
    try {
      const payeeName = (existing as any).vendors?.name || (existing as any).customers?.name || "—";
      const bankAccountName = (existing as any).accounts?.account_name || "—";
      const pdfLines = ((existing as any).payment_voucher_lines ?? []).map((l: any) => ({
        description: l.description,
        account_name: l.accounts?.account_name || "—",
        amount: Number(l.amount),
      }));
      await printCheckPdf(
        {
          chequeNumber: existing.cheque_number,
          printLater: existing.print_later || false,
          paymentDate: existing.payment_date,
          payeeName,
          mailingAddress: (existing as any).mailing_address || null,
          memo: existing.memo,
          bankAccountName,
          totalAmount: Number(existing.total_amount),
          lines: pdfLines,
        },
        appUser.tenant_id
      );
    } catch (e: any) {
      toast.error(e.message || "Failed to generate check PDF");
    } finally {
      setIsPrinting(false);
    }
  };

  const handleCopy = () => {
    if (!existing) return;
    navigate("/checks/new", {
      state: {
        copyFrom: {
          payee_id: existing.payee_id,
          payee_vendor_id: (existing as any).payee_vendor_id,
          permit_number: (existing as any).permit_number,
          payment_account_id: existing.payment_account_id,
          memo: existing.memo,
          mailing_address: (existing as any).mailing_address,
          location_id: (existing as any).location_id,
          lines: ((existing as any).payment_voucher_lines ?? []).map((l: any) => ({
            account_id: l.account_id,
            description: l.description || "",
            amount: Number(l.amount),
            customer_id: l.customer_id,
            is_billable: l.is_billable,
            cost_center_id: l.cost_center_id,
            is_taxable: l.is_taxable ?? false,
          })),
        },
      },
    });
  };

  const handleViewJournal = () => {
    if (existing?.journal_entry_id) navigate(`/accounting/journals/${existing.journal_entry_id}`);
  };

  return (
    <div className="flex flex-col min-h-screen bg-muted/20">
      <CheckTitleBar
        chequeNumber={chequeNumber}
        printLater={printLater}
        isNew={isNew}
        status={existing?.status}
        totalAmount={totalAmount}
        backTo="/banking/write-checks"
      />

      <div className="flex-1 overflow-y-auto p-8 space-y-8 max-w-[1400px] w-full mx-auto">
        <CheckHeaderSection
          disabled={disabled}
          payeeType={payeeType}
          onPayeeTypeChange={setPayeeType}
          payeeId={payeeId}
          onPayeeIdChange={setPayeeId}
          payeeVendorId={payeeVendorId}
          onPayeeVendorIdChange={setPayeeVendorId}
          vendors={(vendors ?? []) as any}
          customers={(customers ?? []) as any}
          paymentAccountId={paymentAccountId}
          onPaymentAccountIdChange={setPaymentAccountId}
          bankBalance={bankBalance}
          mailingAddress={mailingAddress}
          onMailingAddressChange={setMailingAddress}
          paymentDate={paymentDate}
          onPaymentDateChange={setPaymentDate}
          chequeNumber={chequeNumber}
          onChequeNumberChange={setChequeNumber}
          printLater={printLater}
          onPrintLaterChange={setPrintLater}
          locationTrackingEnabled={locationTrackingEnabled}
          locationLabel={locationLabel}
          locationId={locationId}
          onLocationIdChange={setLocationId}
          locations={(locations ?? []) as any}
          permitNumber={permitNumber}
          onPermitNumberChange={setPermitNumber}
          errors={errors}
        />

        <CheckCategoryLines
          disabled={disabled}
          lines={lines}
          onChange={setLines}
          paymentAccountId={paymentAccountId}
          customers={(customers ?? []) as any}
          classTrackingEnabled={classTrackingEnabled}
          costCenters={(costCenters ?? []) as any}
          errors={errors}
        />

        <div className="flex justify-end">
          <div className="text-right">
            <span className="text-sm text-muted-foreground mr-3">Total</span>
            <span className="text-lg font-bold font-mono">{formatCurrency(totalAmount)}</span>
          </div>
        </div>

        {lines.filter((l) => l.account_id && l.amount > 0).map((line, idx) => (
          <BudgetWarningBanner
            key={`budget-check-${idx}-${line.account_id}`}
            accountId={line.account_id}
            amount={line.amount}
            transactionDate={format(paymentDate, "yyyy-MM-dd")}
          />
        ))}

        <CheckMemoAttachments disabled={disabled} memo={memo} onMemoChange={setMemo} />
      </div>

      <CheckActionBar
        isNew={isNew}
        isVoided={isVoided}
        isPending={createMutation.isPending}
        isValid={isValid}
        isPrinting={isPrinting}
        onCancel={() => navigate("/banking/write-checks")}
        onClear={resetForm}
        onSave={() => handleAttemptSave(false)}
        onSaveAndNew={() => handleAttemptSave(true)}
        onPrint={handlePrint}
        onVoid={() => { setVoidReason(""); setShowVoidConfirm(true); }}
        onCopy={handleCopy}
        onViewJournal={handleViewJournal}
        onAuditHistory={() => setShowAuditHistory(true)}
        onMakeRecurring={() => setShowRecurringDialog(true)}
      />

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post Check?</AlertDialogTitle>
            <AlertDialogDescription>
              Total <strong>{formatCurrency(totalAmount)}</strong> will be posted to the ledger as a balanced
              journal entry. Once posted, this check becomes immutable — only a void can adjust it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmedSave}>Post Check</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showVoidConfirm} onOpenChange={setShowVoidConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void check {existing?.cheque_number || existing?.voucher_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This posts a reversing journal entry and marks the check voided. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label>Reason (optional)</Label>
            <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Entered in error" className="mt-1" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={voidMutation.isPending}
              onClick={handleVoid}
            >
              {voidMutation.isPending ? "Voiding…" : "Void Check"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CheckAuditHistorySheet voucherId={id ?? null} open={showAuditHistory} onOpenChange={setShowAuditHistory} />

      {!isNew && (
        <CheckRecurringDialog
          open={showRecurringDialog}
          onOpenChange={setShowRecurringDialog}
          paymentAccountId={paymentAccountId}
          payeeId={payeeType === "customer" ? payeeId || undefined : undefined}
          payeeVendorId={payeeType === "vendor" ? payeeVendorId || undefined : undefined}
          memo={memo}
          lines={lines}
        />
      )}
    </div>
  );
}
