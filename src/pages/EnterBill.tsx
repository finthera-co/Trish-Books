import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import {
  ArrowLeft, Plus, Trash2, Copy, Paperclip, Printer, Download, AlertTriangle,
  ChevronsUpDown, ChevronDown, Check, Search, Loader2, FileText, CreditCard, X, Ban, Repeat,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectGroup, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";
import { TERM_OPTIONS, termToDays, addDays } from "@/lib/paymentTerms";
import { CURRENCIES, BASE_CURRENCY } from "@/lib/currencies";
import { computeBillStatus, BILL_STATUS_BADGE } from "@/lib/billStatus";
import { calculateLineTax, type TaxMemberInput } from "@/lib/taxEngine";
import { useTaxProfile, useTaxGroups, useTaxCodes, currentRate } from "@/hooks/useTaxEngine";
import { useVendorsWithBalance, useCreateVendorWithOB } from "@/hooks/useSubledgerData";
import { useAccounts, useCustomers, useProducts } from "@/hooks/useData";
import { QuickProductDialog } from "@/components/invoices/QuickProductDialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { useCostCenters, useLocations } from "@/hooks/useDimensions";
import { useHideSidebar, useSetHideSidebar } from "@/stores/useAppStore";
import {
  useSupplierBill, useSupplierBills, useCreateSupplierBill, useUpdateSupplierBill, checkForDuplicateBills,
  useBillAttachments, useUploadBillAttachment, useDeleteBillAttachment,
} from "@/hooks/useProcurement";
import { usePostSupplierBill, useVoidSupplierBill } from "@/hooks/useAPModule";
import { useCreateRecurringBillTemplate } from "@/hooks/useRecurringBills";
import AccountCombobox from "@/components/shared/AccountCombobox";

interface LineRow {
  key: string;
  account_id: string;
  description: string;
  sku: string;
  product_id: string;
  qty: string;
  unit_cost: string;
  /** Derived = qty × unit_cost, kept in sync by updateLine. Every totals/tax/payload
   *  calculation below reads this — qty/unit_cost are just the editable inputs. */
  amount: string;
  tax_sel: string; // "" | `c:${id}` | `g:${id}`
  is_tax_inclusive: boolean;
  customer_id: string | null;
  is_billable: boolean;
  cost_center_id: string | null;
}

const EXPENSE_ACCOUNT_TYPES = ["Expense", "Cost of Goods Sold", "Other Expense", "Asset", "Liability"];

let keySeq = 0;
const newLine = (): LineRow => ({
  key: `l${++keySeq}`, account_id: "", description: "", sku: "", product_id: "", qty: "1", unit_cost: "", amount: "", tax_sel: "",
  is_tax_inclusive: false, customer_id: null, is_billable: false, cost_center_id: null,
});

export default function EnterBill() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = !id;

  const { appUser } = useAuth();
  const { data: existing, isLoading: loadingExisting } = useSupplierBill(id);
  const { data: vendors } = useVendorsWithBalance();
  const { data: accounts } = useAccounts();
  const { data: customers } = useCustomers();
  const { data: products } = useProducts();
  const { data: accountSettings } = useAccountSettings();
  const { data: costCenters } = useCostCenters();
  const { data: locations } = useLocations();
  const classTrackingEnabled = !!accountSettings?.class_tracking_enabled;
  const locationTrackingEnabled = !!accountSettings?.location_tracking_enabled;
  const locationLabel = accountSettings?.location_label || "Location";
  const { data: taxProfile } = useTaxProfile();
  const { data: taxGroups } = useTaxGroups();
  const { data: taxCodes } = useTaxCodes();
  const { data: allBills } = useSupplierBills();

  const createBill = useCreateSupplierBill();
  const updateBill = useUpdateSupplierBill();
  const postBill = usePostSupplierBill();
  const voidBill = useVoidSupplierBill();
  const createVendor = useCreateVendorWithOB();

  const { data: attachments } = useBillAttachments(id);
  const uploadAttachment = useUploadBillAttachment();
  const deleteAttachment = useDeleteBillAttachment();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const printRef = useRef<HTMLDivElement>(null);

  const isPosted = existing?.status && existing.status !== "draft";
  const computedStatus = existing ? computeBillStatus({ ...existing, amount_paid: existing.amount_paid ?? 0 }) : "draft";

  // ── Header state ──────────────────────────────────────────────────────
  const [vendorId, setVendorId] = useState("");
  const [vendorPopoverOpen, setVendorPopoverOpen] = useState(false);
  const [vendorSearch, setVendorSearch] = useState("");
  const [billDate, setBillDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [dueDate, setDueDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("net_30");
  const [vendorRef, setVendorRef] = useState("");
  const [permitNo, setPermitNo] = useState("");
  const [memo, setMemo] = useState("");
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage");
  const [discountValue, setDiscountValue] = useState("0");
  const [shippingAmount, setShippingAmount] = useState("0");
  const [shippingAccountId, setShippingAccountId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [currency, setCurrency] = useState("LKR");
  const [exchangeRate, setExchangeRate] = useState(1);
  const [lines, setLines] = useState<LineRow[]>([newLine()]);

  const [showAddVendor, setShowAddVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  const [newVendorEmail, setNewVendorEmail] = useState("");
  const [newVendorAddress, setNewVendorAddress] = useState("");
  const [newVendorTerms, setNewVendorTerms] = useState("net_30");

  const [duplicates, setDuplicates] = useState<any[] | null>(null);
  const [pendingAction, setPendingAction] = useState<"save" | "saveNew" | "saveClose" | "saveSchedule" | null>(null);
  const [saving, setSaving] = useState(false);
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [showMakeRecurring, setShowMakeRecurring] = useState(false);
  const [recurringName, setRecurringName] = useState("");
  const [recurringFrequency, setRecurringFrequency] = useState<"weekly" | "monthly" | "quarterly" | "yearly">("monthly");
  const [recurringStartDate, setRecurringStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [recurringAutoPost, setRecurringAutoPost] = useState(false);
  const createRecurringTemplate = useCreateRecurringBillTemplate();

  const isEditable = isNew || !isPosted;

  // Collapse the module nav panel while entering a bill — this form is wide
  // (10-column item table) and benefits from the extra width. Restores
  // whatever the sidebar's prior state was on unmount rather than forcing it
  // back open, so a user who'd already collapsed it isn't surprised.
  const sidebarHidden = useHideSidebar();
  const setSidebarHidden = useSetHideSidebar();
  useEffect(() => {
    const prev = sidebarHidden;
    setSidebarHidden(true);
    return () => setSidebarHidden(prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Hydrate from an existing bill ─────────────────────────────────────
  useEffect(() => {
    if (!existing || isNew) return;
    setVendorId(existing.vendor_id);
    setBillDate(existing.bill_date);
    setDueDate(existing.due_date || "");
    setPaymentTerms((existing as any).payment_terms || "net_30");
    setVendorRef(existing.vendor_ref || "");
    setPermitNo((existing as any).permit_no || "");
    setMemo(existing.notes || "");
    setDiscountType(((existing as any).discount_type as any) || "percentage");
    setDiscountValue(String((existing as any).discount_value ?? 0));
    setShippingAmount(String((existing as any).shipping_amount ?? 0));
    setShippingAccountId((existing as any).shipping_account_id || "");
    setLocationId((existing as any).location_id || "");
    setCurrency((existing as any).currency || "LKR");
    setExchangeRate(Number((existing as any).exchange_rate) || 1);
    const existingLines = (existing as any).lines as any[] | undefined;
    if (existingLines?.length) {
      setLines(
        existingLines.map((l) => ({
          key: `e${l.id}`,
          account_id: l.account_id || "",
          description: l.description || "",
          sku: l.sku || "",
          product_id: l.product_id || "",
          qty: String(l.qty ?? 1),
          unit_cost: String(l.unit_cost ?? 0),
          amount: String((Number(l.qty ?? 1)) * (Number(l.unit_cost ?? 0))),
          tax_sel: l.tax_group_id ? `g:${l.tax_group_id}` : l.tax_code_id ? `c:${l.tax_code_id}` : "",
          is_tax_inclusive: !!l.is_tax_inclusive,
          customer_id: l.customer_id || null,
          is_billable: !!l.is_billable,
          cost_center_id: l.cost_center_id || null,
        }))
      );
    }
  }, [existing, isNew]);

  // Vendor default terms only apply while creating a new bill — never
  // overwrite a hydrated existing bill.
  useEffect(() => {
    if (!isNew || !vendorId) return;
    const vendor = (vendors ?? []).find((v: any) => v.id === vendorId);
    if (!vendor) return;
    setPaymentTerms(vendor.payment_terms || "net_30");
    setCurrency(vendor.currency || "LKR");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  useEffect(() => {
    if (billDate) setDueDate((prev) => addDays(billDate, termToDays(paymentTerms)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billDate, paymentTerms]);

  // Auto-fill the FX rate from the latest stored rate for the chosen
  // currency, same pattern as CreateInvoice.tsx. LKR is the base currency
  // (rate always 1). The user can override the fetched rate.
  useEffect(() => {
    if (currency === "LKR") { setExchangeRate(1); return; }
    if (!appUser?.tenant_id || !billDate) return;
    supabase
      .rpc("fx_rate" as any, { p_tenant_id: appUser.tenant_id, p_currency: currency, p_date: billDate })
      .then(({ data }: any) => setExchangeRate(Number(data) || 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, billDate, appUser?.tenant_id]);

  const selectedVendor = (vendors ?? []).find((v: any) => v.id === vendorId);

  const vendorOverdue = useMemo(() => {
    if (!vendorId || !allBills) return 0;
    return (allBills as any[])
      .filter((b) => b.vendor_id === vendorId)
      .map((b) => ({ ...b, amount_paid: Number(b.amount_paid ?? 0) }))
      .filter((b) => computeBillStatus(b) === "overdue")
      .reduce((s, b) => s + (Number(b.total_amount) - b.amount_paid), 0);
  }, [vendorId, allBills]);

  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    if (!q) return vendors ?? [];
    return (vendors ?? []).filter((v: any) => v.name.toLowerCase().includes(q));
  }, [vendors, vendorSearch]);

  // ── Expense accounts + tax lookups ────────────────────────────────────
  const expenseAccounts = useMemo(
    () => (accounts as any[] ?? []).filter((a) => a.is_active && EXPENSE_ACCOUNT_TYPES.includes(a.account_type)),
    [accounts]
  );
  const shippingAccounts = expenseAccounts;

  const vatRegistered = !!taxProfile?.is_vat_registered;
  const ssclLiable = !!taxProfile?.is_sscl_liable;
  const codesById = useMemo(() => new Map((taxCodes || []).map((c) => [c.id, c])), [taxCodes]);
  const codeAllowed = (c: any) => {
    if (c.collection_mode !== "input" && c.collection_mode !== "reverse_charge") return false;
    if (c.tax_type === "VAT" && !vatRegistered) return false;
    if (c.tax_type === "SSCL" && !ssclLiable) return false;
    return true;
  };
  const purchasableCodes = useMemo(
    () => (taxCodes || []).filter((c) => c.is_active && codeAllowed(c)),
    [taxCodes, vatRegistered, ssclLiable]
  );
  const purchasableGroups = useMemo(
    () => (taxGroups || []).filter((g) =>
      g.is_active && g.tax_group_members.length > 0 &&
      g.tax_group_members.every((m) => { const c = codesById.get(m.tax_code_id); return c && codeAllowed(c); })
    ),
    [taxGroups, codesById, vatRegistered, ssclLiable]
  );

  const membersFor = (sel: string): TaxMemberInput[] => {
    if (sel.startsWith("g:")) {
      const g = (taxGroups || []).find((x) => x.id === sel.slice(2));
      if (!g) return [];
      return [...g.tax_group_members]
        .sort((a, b) => a.apply_order - b.apply_order)
        .map((m) => {
          const c = codesById.get(m.tax_code_id);
          if (!c) return null;
          return {
            taxCodeId: c.id, code: c.code, rate: currentRate(c, billDate) ?? 0,
            isCompound: m.compound_on_previous, applyOrder: m.apply_order,
            collectionMode: c.collection_mode as any,
          };
        })
        .filter(Boolean) as TaxMemberInput[];
    }
    if (sel.startsWith("c:")) {
      const c = codesById.get(sel.slice(2));
      if (!c) return [];
      return [{ taxCodeId: c.id, code: c.code, rate: currentRate(c, billDate) ?? 0, isCompound: false, applyOrder: 0, collectionMode: c.collection_mode as any }];
    }
    return [];
  };

  // ── Totals ─────────────────────────────────────────────────────────────
  const rawSubtotal = useMemo(
    () => lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0),
    [lines]
  );
  const discountValueNum = parseFloat(discountValue) || 0;
  const discountTotal = useMemo(() => {
    if (discountType === "fixed") return Math.min(discountValueNum, rawSubtotal);
    return Math.round(rawSubtotal * (discountValueNum / 100) * 100) / 100;
  }, [discountType, discountValueNum, rawSubtotal]);
  const discountRatio = rawSubtotal > 0 ? discountTotal / rawSubtotal : 0;

  const lineCalcs = useMemo(() => {
    return lines.map((l) => {
      const rawAmount = parseFloat(l.amount) || 0;
      const netAmount = Math.round(rawAmount * (1 - discountRatio) * 100) / 100;
      const members = membersFor(l.tax_sel);
      if (members.length === 0 || netAmount <= 0) {
        return { net: Math.max(0, netAmount), tax: 0 };
      }
      const first = codesById.get(members[0].taxCodeId);
      const result = calculateLineTax({
        lineAmount: netAmount,
        isInclusive: l.is_tax_inclusive,
        members,
        roundingMethod: (first?.rounding_method as any) || "half_up",
        roundingLevel: "line",
        documentDate: billDate,
      });
      return { net: result.exclusiveBase, tax: result.taxes.reduce((s, t) => s + t.amount, 0) };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    });
  }, [lines, discountRatio, taxGroups, taxCodes, billDate]);

  const subtotalNet = useMemo(() => Math.round(lineCalcs.reduce((s, c) => s + c.net, 0) * 100) / 100, [lineCalcs]);
  const taxTotal = useMemo(() => Math.round(lineCalcs.reduce((s, c) => s + c.tax, 0) * 100) / 100, [lineCalcs]);
  const shippingNum = parseFloat(shippingAmount) || 0;
  const grandTotal = Math.round((subtotalNet + taxTotal + shippingNum) * 100) / 100;
  // Once posted, the persisted total_amount is authoritative (computed by the
  // posting RPC's own tax logic) — don't display a client-recomputed figure
  // that could drift from it in tax edge cases (reverse charge, capitalized
  // non-recoverable tax, etc).
  const displayTotal = !isEditable && existing ? Number(existing.total_amount) : grandTotal;

  // ── Line editing ────────────────────────────────────────────────────────
  const updateLine = (key: string, patch: Partial<LineRow>) =>
    setLines((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      const next = { ...l, ...patch };
      if (!next.customer_id) next.is_billable = false;
      if ("product_id" in patch) {
        const product: any = (products ?? []).find((p: any) => p.id === patch.product_id);
        if (product) {
          next.description = product.description || product.name;
          next.sku = product.sku || next.sku;
          next.unit_cost = String(Number(product.price) || 0);
          // Non-inventory products carry a purchase-side account; service
          // products only have income_account_id, so leave account_id for
          // the user to pick manually in that case.
          if (product.expense_account_id) next.account_id = product.expense_account_id;
        } else {
          next.account_id = "";
        }
      }
      // Picking an account by hand on a product-linked line detaches the
      // product — same rule CreateInvoice.tsx uses — so the manual choice
      // sticks instead of being silently overwritten by a later product edit.
      if ("account_id" in patch && patch.account_id && l.product_id) {
        next.product_id = "";
      }
      if ("qty" in patch || "unit_cost" in patch) {
        next.amount = String((parseFloat(next.qty) || 0) * (parseFloat(next.unit_cost) || 0));
      }
      return next;
    }));
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const duplicateLine = (key: string) => setLines((ls) => {
    const idx = ls.findIndex((l) => l.key === key);
    if (idx === -1) return ls;
    const copy = { ...ls[idx], key: `l${++keySeq}` };
    return [...ls.slice(0, idx + 1), copy, ...ls.slice(idx + 1)];
  });
  const removeLine = (key: string) => setLines((ls) => (ls.length <= 1 ? ls : ls.filter((l) => l.key !== key)));

  // ── Validation ──────────────────────────────────────────────────────────
  const isForeignBill = currency !== BASE_CURRENCY;
  const validLines = lines.filter((l) => l.account_id && (parseFloat(l.amount) || 0) > 0);
  const errors: string[] = [];
  if (!vendorId) errors.push("Supplier is required.");
  if (!billDate) errors.push("Bill date is required.");
  if (dueDate && billDate && dueDate < billDate) errors.push("Due date cannot be earlier than the bill date.");
  if (validLines.length === 0) errors.push("Add at least one line with an account and an amount.");
  if (shippingNum > 0 && !shippingAccountId) errors.push("Select a GL account for the shipping/freight amount.");
  if (isForeignBill && validLines.some((l) => l.tax_sel)) {
    errors.push("Foreign-currency bills cannot carry tax codes — enter tax-carrying bills in LKR.");
  }
  if (isForeignBill && (!exchangeRate || exchangeRate <= 0)) errors.push("Enter a valid exchange rate.");

  // ── Save ────────────────────────────────────────────────────────────────
  const buildPayload = () => ({
    vendor_id: vendorId,
    bill_date: billDate,
    due_date: dueDate || undefined,
    vendor_ref: vendorRef || undefined,
    tax_amount: taxTotal,
    notes: memo || undefined,
    payment_terms: paymentTerms,
    address_block: selectedVendor?.address || undefined,
    discount_type: discountType,
    discount_value: discountValueNum,
    shipping_amount: shippingNum,
    shipping_account_id: shippingAccountId || null,
    location_id: locationId || null,
    currency,
    exchange_rate: exchangeRate,
    permit_no: permitNo || undefined,
    lines: validLines.map((l) => ({
      account_id: l.account_id,
      description: l.description,
      sku: l.sku || undefined,
      product_id: l.product_id || null,
      qty: parseFloat(l.qty) || 1,
      unit_cost: parseFloat(l.unit_cost) || 0,
      tax_group_id: l.tax_sel.startsWith("g:") ? l.tax_sel.slice(2) : null,
      tax_code_id: l.tax_sel.startsWith("c:") ? l.tax_sel.slice(2) : null,
      is_tax_inclusive: l.is_tax_inclusive,
      customer_id: l.customer_id,
      is_billable: l.is_billable,
      cost_center_id: l.cost_center_id,
    })),
  });

  const doSave = async (action: "save" | "saveNew" | "saveClose" | "saveSchedule") => {
    setSaving(true);
    try {
      const payload = buildPayload();
      let savedId: string;
      if (isNew) {
        savedId = await createBill.mutateAsync(payload as any);
      } else {
        savedId = await updateBill.mutateAsync({ id: id!, ...payload } as any);
      }
      if (action === "saveSchedule") {
        if (isNew || existing?.status === "draft") {
          await postBill.mutateAsync(savedId);
        }
        navigate(`/accounting/pay-bills?vendor=${vendorId}`);
      } else if (action === "saveClose") {
        navigate("/accounting/bills");
      } else if (action === "saveNew") {
        navigate("/accounting/bills/new", { replace: true });
        setVendorId(""); setVendorRef(""); setPermitNo(""); setMemo("");
        setDiscountValue("0"); setShippingAmount("0"); setShippingAccountId("");
        setLines([newLine()]);
        setBillDate(format(new Date(), "yyyy-MM-dd"));
      } else {
        navigate(`/accounting/bills/${savedId}`, { replace: true });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (action: "save" | "saveNew" | "saveClose" | "saveSchedule") => {
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }
    const matches = await checkForDuplicateBills({
      tenantId: selectedVendor?.tenant_id,
      vendorId,
      vendorRef,
      billDate,
      totalAmount: grandTotal,
      excludeBillId: id,
    });
    if (matches.length > 0) {
      setDuplicates(matches);
      setPendingAction(action);
      return;
    }
    doSave(action);
  };

  const confirmDuplicateAndSave = () => {
    setDuplicates(null);
    if (pendingAction) doSave(pendingAction);
    setPendingAction(null);
  };

  const handlePost = async () => {
    if (!id) return;
    await postBill.mutateAsync(id);
  };

  const handleVoid = async () => {
    if (!id) return;
    await voidBill.mutateAsync({ bill_id: id, reason: voidReason.trim() || undefined });
    setShowVoidConfirm(false);
    setVoidReason("");
  };

  const handleMakeRecurring = async () => {
    const validLines = lines.filter((l) => l.account_id && parseFloat(l.amount || "0") > 0);
    if (!vendorId || !recurringName.trim() || validLines.length === 0) return;
    await createRecurringTemplate.mutateAsync({
      vendor_id: vendorId,
      template_name: recurringName.trim(),
      frequency: recurringFrequency,
      interval_count: 1,
      start_date: recurringStartDate,
      auto_post: recurringAutoPost,
      payment_terms: paymentTerms,
      vendor_ref: vendorRef || undefined,
      notes: memo || undefined,
      lines: validLines.map((l) => ({
        account_id: l.account_id,
        description: l.description,
        qty: parseFloat(l.qty) || 1,
        unit_cost: parseFloat(l.unit_cost) || 0,
        customer_id: l.customer_id || null,
        is_billable: l.is_billable,
        cost_center_id: l.cost_center_id || null,
      })),
    });
    setShowMakeRecurring(false);
    setRecurringName("");
  };

  const handleAddVendor = async () => {
    if (!newVendorName.trim()) { toast.error("Vendor name is required"); return; }
    const created = await createVendor.mutateAsync({
      name: newVendorName.trim(),
      email: newVendorEmail || undefined,
      address: newVendorAddress || undefined,
      payment_terms: newVendorTerms,
    } as any);
    setVendorId((created as any).id);
    setShowAddVendor(false);
    setNewVendorName(""); setNewVendorEmail(""); setNewVendorAddress(""); setNewVendorTerms("net_30");
  };

  const handleUploadFile = (file: File) => {
    if (!id) { toast.error("Save the bill first, then attach files."); return; }
    uploadAttachment.mutate({ billId: id, file });
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <html><head><title>Bill ${existing?.bill_number ?? ""}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; color: #222; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .meta { font-size: 13px; color: #555; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        th, td { border: 1px solid #ddd; padding: 6px 10px; font-size: 13px; text-align: left; }
        th { background: #f5f5f5; }
        .amt { text-align: right; }
        .totals { margin-top: 12px; width: 280px; margin-left: auto; font-size: 13px; }
        .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
        .totals .grand { font-weight: 700; font-size: 15px; border-top: 1px solid #333; padding-top: 6px; }
      </style></head><body>${printRef.current.innerHTML}</body></html>
    `);
    w.document.close();
    w.print();
  };

  if (!isNew && loadingExisting) {
    return <div className="p-8 text-center text-muted-foreground">Loading bill…</div>;
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/accounting/bills")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <p className="text-xs text-muted-foreground">Expenses → Bills → {isNew ? "Enter Bill" : "Bill"}</p>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">
                {isNew ? "Bill" : existing?.bill_number}
              </h1>
              {!isNew && (
                <Badge variant={BILL_STATUS_BADGE[computedStatus].variant}>
                  {BILL_STATUS_BADGE[computedStatus].label}
                </Badge>
              )}
            </div>
          </div>
        </div>
        {!isNew && (
          <div className="flex items-center gap-4">
            {existing?.status !== "draft" && existing?.status !== "voided" && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Balance Due</p>
                <p className={cn("text-2xl font-bold", Number(existing?.total_amount ?? 0) - Number(existing?.amount_paid ?? 0) > 0.005 ? "text-destructive" : "text-foreground")}>
                  {formatCurrency(Number(existing?.total_amount ?? 0) - Number(existing?.amount_paid ?? 0), currency)}
                </p>
              </div>
            )}
            <div className="flex items-center gap-2">
            {existing?.status === "draft" && (
              <Button onClick={handlePost} disabled={postBill.isPending}>
                {postBill.isPending ? "Posting…" : "Post Bill"}
              </Button>
            )}
            {existing?.status !== "draft" && (
              <Button
                variant="outline"
                onClick={() => navigate(`/accounting/pay-bills?vendor=${vendorId}`)}
              >
                <CreditCard className="w-4 h-4 mr-2" /> Make Payment
              </Button>
            )}
            {existing?.journal_entry_id && (
              <Button variant="outline" onClick={() => navigate(`/accounting/journals/${existing.journal_entry_id}`)}>
                <FileText className="w-4 h-4 mr-2" /> View Journal
              </Button>
            )}
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="w-4 h-4 mr-2" /> Print
            </Button>
            {existing?.status !== "draft" && existing?.status !== "voided" && Number(existing?.amount_paid ?? 0) === 0 && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => { setVoidReason(""); setShowVoidConfirm(true); }}
              >
                <Ban className="w-4 h-4 mr-2" /> Void Bill
              </Button>
            )}
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={showVoidConfirm} onOpenChange={setShowVoidConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void bill {existing?.bill_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This posts a reversing journal entry and marks the bill voided. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1">
            <Label className="text-xs text-muted-foreground">Reason (optional)</Label>
            <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Entered in error" className="mt-1" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={voidBill.isPending}
              onClick={handleVoid}
            >
              {voidBill.isPending ? "Voiding…" : "Void Bill"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isPosted && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-warning shrink-0" />
          <div>This bill is <strong>{BILL_STATUS_BADGE[computedStatus].label.toLowerCase()}</strong> and posted — it is immutable.</div>
        </div>
      )}

      {/* Supplier + Header */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <Label>Supplier *</Label>
              <div className="flex gap-2">
                <Popover open={vendorPopoverOpen} onOpenChange={setVendorPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      disabled={!isEditable}
                      className="flex-1 justify-between font-normal"
                    >
                      {selectedVendor?.name || "Search supplier…"}
                      <ChevronsUpDown className="w-4 h-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput placeholder="Search suppliers…" value={vendorSearch} onValueChange={setVendorSearch} />
                      <CommandList>
                        <CommandEmpty>No supplier found.</CommandEmpty>
                        <CommandGroup>
                          {filteredVendors.map((v: any) => (
                            <CommandItem key={v.id} value={v.id} onSelect={() => { setVendorId(v.id); setVendorPopoverOpen(false); }}>
                              <Check className={cn("mr-2 h-4 w-4", vendorId === v.id ? "opacity-100" : "opacity-0")} />
                              <span className="flex-1">{v.name}</span>
                              <span className="text-xs text-muted-foreground">{formatCurrency(v.ap_balance)}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Button variant="outline" size="icon" disabled={!isEditable} onClick={() => setShowAddVendor(true)} title="Add New Supplier">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {selectedVendor && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
                  <div>Current balance: <span className="font-medium text-foreground">{formatCurrency(selectedVendor.ap_balance)}</span></div>
                  <div>Overdue: <span className={cn("font-medium", vendorOverdue > 0 ? "text-destructive" : "text-foreground")}>{formatCurrency(vendorOverdue)}</span></div>
                  <div className="col-span-2">Balance after this bill: <span className="font-semibold text-foreground">{formatCurrency(selectedVendor.ap_balance + grandTotal)}</span></div>
                </div>
              )}
            </div>

            <div>
              <Label>Mailing address</Label>
              <Textarea value={selectedVendor?.address || ""} readOnly rows={4} className="resize-none bg-muted/50 text-sm" placeholder="Auto-filled from supplier" />
            </div>
          </div>

          {selectedVendor && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg bg-muted/40 p-3">
              <div>
                <p className="font-medium text-foreground text-sm">{selectedVendor.name}</p>
                <p className="text-xs text-muted-foreground">{selectedVendor.email || "No email on file"}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Bill Pay ACH info</p>
                {selectedVendor.bank_account_no ? (
                  <p className="text-xs text-muted-foreground">
                    {selectedVendor.bank_name}{selectedVendor.bank_branch ? ` — ${selectedVendor.bank_branch}` : ""}
                    {" · "}{selectedVendor.bank_account_name || selectedVendor.name} {selectedVendor.bank_account_no}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Missing — no bank details on file for this vendor</p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <Label>Terms</Label>
                <Select value={paymentTerms} onValueChange={setPaymentTerms} disabled={!isEditable}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TERM_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Bill Date *</Label>
                <Input type="date" value={billDate} disabled={!isEditable} onChange={(e) => setBillDate(e.target.value)} />
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={dueDate} disabled={!isEditable} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div>
                <Label>Bill no.</Label>
                {isNew ? (
                  <Input value="(auto-generated)" readOnly disabled className="bg-muted/50 text-muted-foreground" />
                ) : (
                  <Input value={existing?.bill_number || ""} readOnly disabled className="bg-muted/50" />
                )}
              </div>
              {locationTrackingEnabled && (
                <div>
                  <Label>{locationLabel}</Label>
                  <Select value={locationId || "__none__"} onValueChange={(v) => setLocationId(v === "__none__" ? "" : v)} disabled={!isEditable}>
                    <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Not set</SelectItem>
                      {(locations ?? []).map((l) => (
                        <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Permit No.</Label>
                <Input placeholder="Optional" value={permitNo} disabled={!isEditable} onChange={(e) => setPermitNo(e.target.value)} />
              </div>
              <div>
                <Label>Reference No.</Label>
                <Input placeholder="Vendor's invoice #" value={vendorRef} disabled={!isEditable} onChange={(e) => setVendorRef(e.target.value)} />
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency} disabled={!isEditable}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {isForeignBill && (
                <div>
                  <Label>Exchange rate (1 {currency} → {BASE_CURRENCY})</Label>
                  <Input
                    type="number" step="0.0001" min="0" className="font-mono"
                    value={exchangeRate} disabled={!isEditable}
                    onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 0)}
                  />
                </div>
              )}
            </div>
          {isForeignBill && (
            <p className="text-xs text-muted-foreground">
              Foreign-currency bill — amounts below are in {currency}. Tax codes aren't available on foreign-currency bills; enter tax-carrying bills in {BASE_CURRENCY}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Category Details */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <Label className="text-base font-semibold">Category Details</Label>
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">Product</TableHead>
                  <TableHead className="min-w-[260px]">Account</TableHead>
                  <TableHead className="min-w-[100px]">SKU</TableHead>
                  <TableHead className="min-w-[180px]">Description</TableHead>
                  <TableHead className="w-32 text-right">Qty</TableHead>
                  <TableHead className="w-40 text-right">Rate</TableHead>
                  <TableHead className="w-32 text-right">Amount</TableHead>
                  <TableHead className="w-20 text-center">Billable</TableHead>
                  <TableHead className="min-w-[160px]">Tax</TableHead>
                  <TableHead className="min-w-[160px]">Customer</TableHead>
                  {classTrackingEnabled && <TableHead className="min-w-[140px]">Class</TableHead>}
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, idx) => (
                  <TableRow key={line.key}>
                    <TableCell>
                      <div className="flex gap-1">
                        <Select
                          value={line.product_id || "__none__"}
                          onValueChange={(v) => updateLine(line.key, { product_id: v === "__none__" ? "" : v })}
                          disabled={!isEditable}
                        >
                          <SelectTrigger className="h-9 min-w-0 flex-1 text-xs"><SelectValue placeholder="Link a product" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— No product —</SelectItem>
                            {(products ?? []).map((p: any) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {isEditable && (
                          <QuickProductDialog onCreated={(pid) => updateLine(line.key, { product_id: pid })} />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <AccountCombobox
                        options={expenseAccounts}
                        value={line.account_id}
                        onChange={(v) => updateLine(line.key, { account_id: v })}
                        placeholder="Search accounts…"
                        className="h-9 w-full"
                        disabled={!isEditable}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={line.sku}
                        onChange={(e) => updateLine(line.key, { sku: e.target.value })}
                        placeholder="SKU"
                        disabled={!isEditable}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={line.description}
                        onChange={(e) => updateLine(line.key, { description: e.target.value })}
                        placeholder="Description"
                        disabled={!isEditable}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number" min="0" step="0.01" className="text-right"
                        value={line.qty}
                        onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                        disabled={!isEditable}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number" min="0" step="0.01" className="text-right"
                        value={line.unit_cost}
                        onChange={(e) => updateLine(line.key, { unit_cost: e.target.value })}
                        disabled={!isEditable}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground pr-3">
                      {formatCurrency(parseFloat(line.amount) || 0, currency)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={line.is_billable}
                        onCheckedChange={(v) => updateLine(line.key, { is_billable: !!v })}
                        disabled={!isEditable || !line.customer_id}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Select value={line.tax_sel || "none"} onValueChange={(v) => updateLine(line.key, { tax_sel: v === "none" ? "" : v })} disabled={!isEditable || isForeignBill}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="No tax" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Tax</SelectItem>
                            {purchasableGroups.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Groups</SelectLabel>
                                {purchasableGroups.map((g) => <SelectItem key={g.id} value={`g:${g.id}`}>{g.code}</SelectItem>)}
                              </SelectGroup>
                            )}
                            {purchasableCodes.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Codes</SelectLabel>
                                {purchasableCodes.map((c) => (
                                  <SelectItem key={c.id} value={`c:${c.id}`}>{c.code} ({currentRate(c, billDate) ?? 0}%)</SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                          </SelectContent>
                        </Select>
                        {line.tax_sel && (
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground pl-0.5">
                            <label className="flex items-center gap-1">
                              <Checkbox
                                className="h-3.5 w-3.5"
                                checked={line.is_tax_inclusive}
                                onCheckedChange={(v) => updateLine(line.key, { is_tax_inclusive: !!v })}
                                disabled={!isEditable}
                              />
                              Inclusive
                            </label>
                            <span>Tax: {formatCurrency(lineCalcs[idx]?.tax || 0)}</span>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select value={line.customer_id || "__none__"} onValueChange={(v) => updateLine(line.key, { customer_id: v === "__none__" ? null : v })} disabled={!isEditable}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {(customers ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    {classTrackingEnabled && (
                      <TableCell>
                        <Select
                          value={line.cost_center_id || "__none__"}
                          onValueChange={(v) => updateLine(line.key, { cost_center_id: v === "__none__" ? null : v })}
                          disabled={!isEditable}
                        >
                          <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {(costCenters ?? []).map((cc) => <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!isEditable} onClick={() => duplicateLine(line.key)} title="Duplicate row">
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!isEditable || lines.length <= 1} onClick={() => removeLine(line.key)} title="Delete row">
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={addLine} disabled={!isEditable}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Add lines
              </Button>
              <Button
                variant="outline" size="sm" disabled={!isEditable}
                onClick={() => setLines([newLine()])}
              >
                Clear all lines
              </Button>
            </div>
            <div className="text-right">
              <span className="text-sm text-muted-foreground mr-3">Total</span>
              <span className="text-lg font-semibold tabular-nums">{formatCurrency(displayTotal, currency)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Attachments + Memo */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div>
              <Label className="text-base font-semibold">Attachments</Label>
              <div className="mt-2 space-y-2">
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFile(f); e.target.value = ""; }} />
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isNew || uploadAttachment.isPending}>
                  <Paperclip className="w-3.5 h-3.5 mr-1.5" /> Attach file
                </Button>
                {isNew && <p className="text-xs text-muted-foreground">Save the bill first to attach files.</p>}
                {(attachments ?? []).map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <a href={a.file_url} target="_blank" rel="noreferrer" className="truncate hover:underline">{a.file_name}</a>
                    <div className="flex items-center gap-1 shrink-0">
                      <a href={a.file_url} target="_blank" rel="noreferrer">
                        <Button variant="ghost" size="icon" className="h-7 w-7"><Download className="w-3.5 h-3.5" /></Button>
                      </a>
                      {isEditable && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteAttachment.mutate({ ...a, bill_id: id })}>
                          <X className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <Separator />
            <div>
              <Label>Memo</Label>
              <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} placeholder="Internal notes…" disabled={!isEditable} />
            </div>
          </CardContent>
        </Card>

        {/* Totals */}
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Discount</Label>
                <div className="flex gap-2">
                  <Select value={discountType} onValueChange={(v) => setDiscountType(v as any)} disabled={!isEditable}>
                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">%</SelectItem>
                      <SelectItem value="fixed">Rs.</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="number" min="0" step="0.01" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} disabled={!isEditable} />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Shipping / Freight</Label>
                <Input type="number" min="0" step="0.01" value={shippingAmount} onChange={(e) => setShippingAmount(e.target.value)} disabled={!isEditable} />
              </div>
              {shippingNum > 0 && (
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">Shipping Account *</Label>
                  <AccountCombobox options={shippingAccounts} value={shippingAccountId} onChange={setShippingAccountId} placeholder="Select account" disabled={!isEditable} />
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">{formatCurrency(rawSubtotal, currency)}</span></div>
              {discountTotal > 0 && (
                <div className="flex justify-between text-destructive"><span>Discount</span><span className="font-mono">-{formatCurrency(discountTotal, currency)}</span></div>
              )}
              {taxTotal > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="font-mono">{formatCurrency(taxTotal, currency)}</span></div>
              )}
              {shippingNum > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span className="font-mono">{formatCurrency(shippingNum, currency)}</span></div>
              )}
              <div className="flex justify-between border-t pt-2 font-bold text-base">
                <span>Total</span><span className="font-mono">{formatCurrency(displayTotal, currency)}</span>
              </div>
              {!isNew && (
                <div className="flex justify-between pt-1 text-destructive font-semibold">
                  <span>Balance Due</span>
                  <span className="font-mono">{formatCurrency(displayTotal - Number(existing?.amount_paid ?? 0), currency)}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Printable summary (hidden on screen) */}
      <div className="hidden">
        <div ref={printRef}>
          <h1>BILL</h1>
          <div className="meta">
            {selectedVendor?.name}<br />
            Bill # {existing?.bill_number}<br />
            Bill Date: {billDate ? formatDate(billDate) : ""} &nbsp; Due Date: {dueDate ? formatDate(dueDate) : ""}
          </div>
          <table>
            <thead><tr><th>Account</th><th>Description</th><th className="amt">Amount</th></tr></thead>
            <tbody>
              {validLines.map((l, i) => {
                const acc = expenseAccounts.find((a: any) => a.id === l.account_id);
                return (
                  <tr key={i}>
                    <td>{acc?.account_code} — {acc?.account_name}</td>
                    <td>{l.description}</td>
                    <td className="amt">{formatCurrency(parseFloat(l.amount) || 0, currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="totals">
            <div><span>Subtotal</span><span>{formatCurrency(rawSubtotal, currency)}</span></div>
            {discountTotal > 0 && <div><span>Discount</span><span>-{formatCurrency(discountTotal, currency)}</span></div>}
            {taxTotal > 0 && <div><span>Tax</span><span>{formatCurrency(taxTotal, currency)}</span></div>}
            {shippingNum > 0 && <div><span>Shipping</span><span>{formatCurrency(shippingNum, currency)}</span></div>}
            <div className="grand"><span>Total</span><span>{formatCurrency(displayTotal, currency)}</span></div>
          </div>
          {memo && <p>Memo: {memo}</p>}
        </div>
      </div>

      {/* Action bar */}
      {isEditable && (
        <div className="fixed bottom-0 left-0 right-0 md:left-14 border-t bg-background/95 backdrop-blur px-6 py-3 flex justify-between items-center gap-3 z-10">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={!vendorId || lines.every((l) => !l.account_id || !parseFloat(l.amount || "0"))}
            onClick={() => setShowMakeRecurring(true)}
          >
            <Repeat className="w-4 h-4 mr-2" /> Make recurring
          </Button>
          <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate("/accounting/bills")} disabled={saving}>Cancel</Button>
          <Button variant="outline" onClick={() => handleSave("save")} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Save
          </Button>
          <div className="flex">
            <Button className="rounded-r-none" onClick={() => handleSave("saveClose")} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Save and Close
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="rounded-l-none border-l border-primary-foreground/20 px-2" disabled={saving}>
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleSave("saveClose")}>Save and close</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSave("saveNew")}>Save and new</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSave("saveSchedule")}>Save and schedule payment</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          </div>
        </div>
      )}

      <Dialog open={showMakeRecurring} onOpenChange={setShowMakeRecurring}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make Recurring</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Creates a schedule that generates a new bill for this vendor with these lines. Manage it later under Recurring Bills.
            </p>
            <div>
              <Label>Template Name *</Label>
              <Input value={recurringName} onChange={(e) => setRecurringName(e.target.value)} placeholder="e.g. Monthly Rent" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Frequency</Label>
                <Select value={recurringFrequency} onValueChange={(v) => setRecurringFrequency(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={recurringStartDate} onChange={(e) => setRecurringStartDate(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="recurring-auto-post" checked={recurringAutoPost} onCheckedChange={(v) => setRecurringAutoPost(!!v)} />
              <Label htmlFor="recurring-auto-post" className="cursor-pointer font-normal">Automatically post generated bills to the GL</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowMakeRecurring(false)}>Cancel</Button>
            <Button onClick={handleMakeRecurring} disabled={createRecurringTemplate.isPending || !recurringName.trim()}>
              {createRecurringTemplate.isPending ? "Creating…" : "Create Schedule"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add New Supplier */}
      <Dialog open={showAddVendor} onOpenChange={setShowAddVendor}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add New Supplier</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} /></div>
            <div><Label>Email</Label><Input type="email" value={newVendorEmail} onChange={(e) => setNewVendorEmail(e.target.value)} /></div>
            <div><Label>Address</Label><Input value={newVendorAddress} onChange={(e) => setNewVendorAddress(e.target.value)} /></div>
            <div>
              <Label>Payment Terms</Label>
              <Select value={newVendorTerms} onValueChange={setNewVendorTerms}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TERM_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={handleAddVendor} disabled={createVendor.isPending || !newVendorName.trim()}>
              {createVendor.isPending ? "Creating…" : "Create Supplier"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Duplicate bill warning */}
      <AlertDialog open={!!duplicates} onOpenChange={(v) => { if (!v) { setDuplicates(null); setPendingAction(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-warning" /> Possible duplicate bill</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-foreground">
                <p>A bill with matching details already exists for this supplier:</p>
                <div className="space-y-1">
                  {(duplicates ?? []).map((d) => (
                    <div key={d.id} className="rounded-md border p-2 flex justify-between">
                      <span className="font-mono">{d.bill_number}{d.vendor_ref ? ` (${d.vendor_ref})` : ""}</span>
                      <span>{formatDate(d.bill_date)} · {formatCurrency(Number(d.total_amount))} · {d.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingAction(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDuplicateAndSave}>Continue Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
