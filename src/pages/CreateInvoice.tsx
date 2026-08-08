import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectGroup, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Plus, Trash2, Send, Save } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCustomers, useAccounts, useProducts } from "@/hooks/useData";
import { useTaxProfile, useTaxGroups, useTaxCodes, currentRate } from "@/hooks/useTaxEngine";
import { calculateLineTax, type TaxMemberInput } from "@/lib/taxEngine";
import { discountFromPercent, percentFromDiscount, apportionDiscount } from "@/lib/lineDiscount";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { usePostInvoice } from "@/hooks/useAccountSettings";
import { useInvoiceTemplates } from "@/hooks/useInvoiceTemplates";
import { QuickCustomerDialog } from "@/components/invoices/QuickCustomerDialog";
import { useSetHideSidebar } from "@/stores/useAppStore";

interface LineItem {
  id: string;
  product_id: string;
  description: string;
  qty: number;
  rate: number;
  /** Encoded tax selection: "g:<groupId>" | "c:<codeId>" | "" (none). */
  tax_sel: string;
  inclusive: boolean;
  /** Discount as a % of qty × rate. Drives `discount`; 0 for a flat-amount discount. */
  discount_pct: number;
  /** Money value of the discount — the figure everything downstream calculates on. */
  discount: number;
  /** Revenue account for THIS line (service or product income acct). Empty = fall back to default sales account in post-invoice. */
  account_id: string;
}

const emptyLine = (): LineItem => ({
  id: crypto.randomUUID(),
  product_id: "",
  description: "",
  qty: 1,
  rate: 0,
  tax_sel: "",
  inclusive: false,
  discount_pct: 0,
  discount: 0,
  account_id: "",
});

const TERM_OPTIONS = [
  { value: "due_on_receipt", label: "Due on receipt", days: 0 },
  { value: "net_15", label: "Net 15", days: 15 },
  { value: "net_30", label: "Net 30", days: 30 },
  { value: "net_45", label: "Net 45", days: 45 },
  { value: "net_60", label: "Net 60", days: 60 },
];
const termToDays = (t: string) => TERM_OPTIONS.find((o) => o.value === t)?.days ?? 30;

// IRD Gazette 2481/22 — permitted Mode of Payment values (optional field).
const MODE_OF_PAYMENT_OPTIONS = [
  "Cash",
  "Bank Transfer",
  "Cheque",
  "Credit/Debit Card",
  "Mobile Payment",
  "Online Payment",
];
const MOP_NONE = "__none__"; // Radix Select cannot use "" as a value
// PDF template picker sentinel: "" (null in DB) = resolve the tenant default at download time.
const TPL_DEFAULT = "__default__";
const addDays = (isoDate: string, days: number) => {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};

export default function CreateInvoice() {
  const navigate = useNavigate();
  // When an :id route param is present we are editing an existing DRAFT invoice
  // in place (same form, no new serial). Posted/voided invoices are not editable.
  const { id: editId } = useParams<{ id: string }>();
  const isEdit = !!editId;
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const { data: customers } = useCustomers();
  const { data: accounts } = useAccounts();
  const { data: products } = useProducts();
  const { data: taxProfile } = useTaxProfile();
  const { data: taxGroups } = useTaxGroups();
  const { data: taxCodes } = useTaxCodes();
  const postInvoiceFn = usePostInvoice();
  const { data: invoiceTemplates } = useInvoiceTemplates();
  const setHideSidebar = useSetHideSidebar();

  // Collapse the module sidebar while drafting an invoice so the line-item
  // grid has room to breathe; restore it on leave.
  useEffect(() => {
    setHideSidebar(true);
    return () => setHideSidebar(false);
  }, [setHideSidebar]);

  const [customerId, setCustomerId] = useState("");
  // Typed if the user wants their own scheme, otherwise generated on save per
  // IRD Gazette 2481/22 (YYMMM_QQQQ_XXXXX).
  const [invoiceNumber, setInvoiceNumber] = useState("");
  // The number the draft already carries, so an edit can tell "left alone"
  // (blank or unchanged) apart from a deliberate renumber.
  const [originalNumber, setOriginalNumber] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("net_30");
  // ── Statutory VAT tax-invoice fields (Gazette 2481/22) ──
  const [branchCode, setBranchCode] = useState("");        // QQQQ segment of the serial
  const [dateOfSupply, setDateOfSupply] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [modeOfPayment, setModeOfPayment] = useState("");  // "" = Not specified
  // Custom PDF template for this invoice; "" = tenant default (resolved at download).
  const [templateId, setTemplateId] = useState("");
  // Multi-currency: document currency + foreign→base (LKR) rate at issue date.
  const [currency, setCurrency] = useState("LKR");
  const [exchangeRate, setExchangeRate] = useState(1);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  // Invoice-level discount — one figure off the whole invoice, entered as a %
  // of the net line total or as money. Apportioned across the lines at save
  // time so tax and revenue land on the discounted value (see apportionDiscount).
  const [docDiscountPct, setDocDiscountPct] = useState(0);
  const [docDiscount, setDocDiscount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  // Guards while an existing draft is being hydrated in edit mode.
  const [loadingExisting, setLoadingExisting] = useState(isEdit);

  // ── Edit mode: hydrate the form from the existing DRAFT invoice ──────
  // Posted/voided invoices are immutable (their GL is already written), so we
  // bounce the user back to the list if they reach this route for one.
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    (async () => {
      const { data: inv, error } = await supabase
        .from("invoices")
        .select("*, invoice_items(*)")
        .eq("id", editId)
        .single();
      if (cancelled) return;
      if (error || !inv) {
        toast.error("Invoice not found");
        navigate("/sales/invoices");
        return;
      }
      if (inv.status !== "draft" || inv.journal_entry_id) {
        toast.error("Only draft invoices can be edited");
        navigate("/sales/invoices");
        return;
      }
      setCustomerId(inv.customer_id ?? "");
      setInvoiceNumber(inv.invoice_number ?? "");
      setOriginalNumber(inv.invoice_number ?? "");
      setIssueDate(inv.issue_date ?? new Date().toISOString().split("T")[0]);
      setDueDate(inv.due_date ?? "");
      setPaymentTerms(inv.payment_terms ?? "net_30");
      setBranchCode(inv.branch_code ?? "");
      setDateOfSupply(inv.date_of_supply ?? "");
      setPlaceOfSupply(inv.place_of_supply ?? "");
      setModeOfPayment(inv.mode_of_payment ?? "");
      setTemplateId((inv as any).template_id ?? "");
      setCurrency((inv as any).currency ?? "LKR");
      setExchangeRate(Number((inv as any).exchange_rate) || 1);
      setNotes(inv.notes ?? "");
      setTerms(inv.terms ?? "");
      const items = ((inv as any).invoice_items ?? []) as any[];
      setDocDiscount(Number((inv as any).document_discount) || 0);
      setDocDiscountPct(Number((inv as any).document_discount_percent) || 0);
      setLines(
        items.length
          ? items.map((it) => ({
              id: crypto.randomUUID(),
              product_id: it.product_id ?? "",
              description: it.description ?? "",
              qty: Number(it.quantity) || 1,
              rate: Number(it.unit_price) || 0,
              tax_sel: it.tax_group_id ? `g:${it.tax_group_id}` : it.tax_code_id ? `c:${it.tax_code_id}` : "",
              inclusive: !!it.is_tax_inclusive,
              discount_pct: Number(it.discount_percent) || 0,
              // The line's OWN discount. discount_amount also carries this line's
              // share of the invoice-level discount, which is re-apportioned from
              // the header figure — taking it from there would compound it.
              discount: Number(it.line_discount_amount ?? it.discount_amount) || 0,
              account_id: it.account_id ?? "",
            }))
          : [emptyLine()]
      );
      setLoadingExisting(false);
    })();
    return () => { cancelled = true; };
  }, [editId, navigate]);

  // Inherit the selected customer's default payment term. Skipped while an
  // existing draft is hydrating so we don't clobber its saved term.
  useEffect(() => {
    if (loadingExisting) return;
    const c = customers?.find((x) => x.id === customerId);
    if (c?.payment_terms) setPaymentTerms(c.payment_terms);
  }, [customerId, customers, loadingExisting]);

  // Auto-compute due date = issue date + term days. The user can still override
  // the date manually afterwards.
  useEffect(() => {
    if (loadingExisting) return; // don't overwrite a hydrating draft's saved due date
    if (issueDate) setDueDate(addDays(issueDate, termToDays(paymentTerms)));
  }, [issueDate, paymentTerms, loadingExisting]);

  // Auto-fill the FX rate from the latest stored rate for the chosen currency.
  // LKR is the base currency (rate 1). The user can override the fetched rate.
  useEffect(() => {
    if (loadingExisting) return;
    if (currency === "LKR") { setExchangeRate(1); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("fx_rate" as any, {
        p_tenant_id: appUser?.tenant_id, p_currency: currency, p_date: issueDate,
      });
      if (!cancelled && data != null) setExchangeRate(Number(data) || 1);
    })();
    return () => { cancelled = true; };
  }, [currency, issueDate, loadingExisting, appUser?.tenant_id]);

  // Account lookups (for journal preview only)
  const arAccount = useMemo(
    () => accounts?.find((a) => a.account_subtype === "Accounts Receivable" || a.account_name?.toLowerCase().includes("accounts receivable")),
    [accounts]
  );
  const revenueAccount = useMemo(
    () => accounts?.find((a) => (a.account_type === "Income" || a.account_type === "Other Income" || a.account_type === "Revenue") && !a.account_name?.toLowerCase().includes("return")),
    [accounts]
  );

  // All active income accounts, for the per-line revenue-account picker. Sorted by code.
  // "Revenue" is the live COA label; "Income"/"Other Income" are defensive and harmless if unused.
  const revenueAccounts = useMemo(
    () =>
      (accounts ?? [])
        .filter(
          (a: any) =>
            a.is_active &&
            (a.account_type === "Revenue" ||
              a.account_type === "Income" ||
              a.account_type === "Other Income"),
        )
        .sort((a: any, b: any) =>
          String(a.account_code).localeCompare(String(b.account_code)),
        ),
    [accounts]
  );

  const productsById = useMemo(
    () => new Map((products || []).map((p: any) => [p.id, p])),
    [products]
  );

  // Inventory-awareness helpers for invoice lines. A product is stock-moving only
  // when it's an inventory type, tracked, and linked to an inventory_items row.
  const isTracked = useCallback((p: any) =>
    !!p && p.type === "inventory" && p.is_tracked && !!p.inventory_item_id, []);
  const onHandOf = useCallback((p: any) =>
    isTracked(p) ? Number(p.inventory_item?.quantity_on_hand) || 0 : null, [isTracked]);
  // Current unit cost for a stocked item (moving-average), falling back to the
  // last purchase price. Null for services / non-inventory items.
  const costOf = useCallback((p: any) => {
    if (!isTracked(p)) return null;
    const c = p.inventory_item?.unit_cost ?? p.inventory_item?.last_purchase_price;
    return c == null ? null : Number(c) || 0;
  }, [isTracked]);
  const typeLabel = useCallback((p: any) => {
    if (!p) return null;
    if (isTracked(p)) return "Stock";
    if (p.type === "service") return "Service";
    return "Non-inv";
  }, [isTracked]);

  const codesById = useMemo(() => new Map((taxCodes || []).map((c) => [c.id, c])), [taxCodes]);
  const vatRegistered = !!taxProfile?.is_vat_registered;
  const ssclLiable = !!taxProfile?.is_sscl_liable;

  // A code is selectable on a SALES invoice only when it is output-mode and
  // its tax type is allowed by the tenant profile (VAT hidden if not
  // registered; SSCL hidden if not liable).
  const codeAllowed = useCallback((c: any) => {
    if (c.collection_mode !== "output") return false;
    if (c.tax_type === "VAT" && !vatRegistered) return false;
    if (c.tax_type === "SSCL" && !ssclLiable) return false;
    return true;
  }, [vatRegistered, ssclLiable]);

  const sellableCodes = useMemo(
    () => (taxCodes || []).filter((c) => c.is_active && codeAllowed(c)),
    [taxCodes, codeAllowed]
  );
  // A group is offered only if every member is allowed by the profile.
  const sellableGroups = useMemo(
    () => (taxGroups || []).filter((g) =>
      g.is_active &&
      g.tax_group_members.length > 0 &&
      g.tax_group_members.every((m) => {
        const c = codesById.get(m.tax_code_id);
        return c && codeAllowed(c);
      })
    ),
    [taxGroups, codesById, codeAllowed]
  );

  // Resolve a line's encoded selection into engine members at the issue date.
  const membersFor = useCallback((sel: string): TaxMemberInput[] => {
    if (sel.startsWith("g:")) {
      const g = (taxGroups || []).find((x) => x.id === sel.slice(2));
      if (!g) return [];
      return [...g.tax_group_members]
        .sort((a, b) => a.apply_order - b.apply_order)
        .map((m) => {
          const c = codesById.get(m.tax_code_id);
          if (!c) return null;
          return {
            taxCodeId: c.id, code: c.code, rate: currentRate(c, issueDate) ?? 0,
            isCompound: m.compound_on_previous, applyOrder: m.apply_order,
            collectionMode: c.collection_mode as any,
          };
        })
        .filter(Boolean) as TaxMemberInput[];
    }
    if (sel.startsWith("c:")) {
      const c = codesById.get(sel.slice(2));
      if (!c) return [];
      return [{
        taxCodeId: c.id, code: c.code, rate: currentRate(c, issueDate) ?? 0,
        isCompound: false, applyOrder: 1, collectionMode: c.collection_mode as any,
      }];
    }
    return [];
  }, [taxGroups, codesById, issueDate]);

  const updateLine = useCallback((id: string, field: string, value: any) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const updated = { ...l, [field]: value };
        if (field === "product_id" && products) {
          const product: any = products.find((p: any) => p.id === value);
          if (product) {
            updated.description = product.description || product.name;
            // Stocked goods default to inventory selling_price when set; otherwise
            // the product master price (current behavior for services/non-inventory).
            const sellPrice = product.inventory_item?.selling_price;
            updated.rate = Number(sellPrice ?? product.price) || 0;
            // Inherit the product's revenue account onto this line.
            updated.account_id = product.income_account_id || "";
            // Default tax from the product (group preferred, then code)
            if (product.default_tax_group_id) updated.tax_sel = `g:${product.default_tax_group_id}`;
            else if (product.default_tax_code_id) updated.tax_sel = `c:${product.default_tax_code_id}`;
          } else {
            // Product cleared → this is now a service line: drop the inherited revenue
            // account so the manual picker takes over, and reset qty (a service bills a
            // flat amount, not qty × rate).
            updated.account_id = "";
            updated.qty = 1;
          }
        }
        // Explicitly choosing a revenue account turns the line into a manually-mapped
        // (service) line: unlink any product and clear the product's auto-filled
        // description so it doesn't linger. Custom text the user typed is preserved.
        if (field === "account_id" && value && l.product_id) {
          const prod: any = products?.find((p: any) => p.id === l.product_id);
          const autoDesc = prod ? (prod.description || prod.name) : null;
          updated.product_id = "";
          updated.qty = 1;
          if (autoDesc && l.description === autoDesc) updated.description = "";
        }
        // ── Keep the discount %/amount pair in step ──────────────────────
        // The percentage is the entry field: it re-derives the money amount
        // whenever it (or the line's gross) changes. Typing straight into the
        // amount box instead re-derives the percentage, so both always agree.
        if (field === "discount_pct") {
          updated.discount = discountFromPercent(updated.qty, updated.rate, updated.discount_pct);
        } else if (field === "discount") {
          updated.discount_pct = percentFromDiscount(updated.qty, updated.rate, updated.discount);
        } else if (updated.discount_pct > 0) {
          // qty / rate / product changed — a % discount follows the new gross.
          updated.discount = discountFromPercent(updated.qty, updated.rate, updated.discount_pct);
        }
        return updated;
      })
    );
  }, [products]);

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));

  // ── Invoice-level discount, apportioned onto the lines ───────────────
  // Everything downstream (tax, revenue split, the server-side recompute) works
  // from per-line figures, so the invoice discount is spread across the lines
  // here and the lines are what get calculated on from this point.
  const lineNets = useMemo(
    () => lines.map((l) => Math.max(0, Math.round((l.qty * l.rate - l.discount) * 100) / 100)),
    [lines],
  );
  const netTotal = useMemo(
    () => Math.round(lineNets.reduce((s, n) => s + n, 0) * 100) / 100,
    [lineNets],
  );
  // A discount can never exceed what's left to discount.
  const docDiscountApplied = useMemo(
    () => Math.min(Math.max(0, docDiscount), netTotal),
    [docDiscount, netTotal],
  );
  const docShares = useMemo(
    () => apportionDiscount(lineNets, docDiscountApplied),
    [lineNets, docDiscountApplied],
  );

  // Same %/amount pairing as a line discount: the % re-derives the money value
  // and keeps following the net total as lines are edited, while typing into
  // the money box re-derives the %.
  const setDocPct = (v: number) => {
    const pct = Math.min(100, Math.max(0, Number(v) || 0));
    setDocDiscountPct(pct);
    setDocDiscount(Math.round(netTotal * pct) / 100);
  };
  const setDocAmount = (v: number) => {
    const amt = Math.max(0, Number(v) || 0);
    setDocDiscount(amt);
    setDocDiscountPct(netTotal > 0 ? Math.min(100, Math.round((amt / netTotal) * 10000) / 100) : 0);
  };
  useEffect(() => {
    if (loadingExisting || docDiscountPct <= 0) return;
    setDocDiscount(Math.round(netTotal * docDiscountPct) / 100);
  }, [netTotal, docDiscountPct, loadingExisting]);

  // ── Live tax computation via the shared engine ──────────────────────
  const lineCalcs = useMemo(() => {
    return lines.map((l, i) => {
      const lineAmount = l.qty * l.rate - l.discount - (docShares[i] ?? 0);
      const members = membersFor(l.tax_sel);
      if (members.length === 0 || lineAmount <= 0) {
        const base = Math.round(Math.max(0, lineAmount) * 100) / 100;
        return { exclusiveBase: base, taxes: [] as any[], lineTotal: base };
      }
      const first = codesById.get(members[0].taxCodeId);
      return calculateLineTax({
        lineAmount,
        isInclusive: l.inclusive,
        members,
        roundingMethod: (first?.rounding_method as any) || "half_up",
        roundingLevel: "line",
        documentDate: issueDate,
      });
    });
  }, [lines, docShares, membersFor, codesById, issueDate]);

  const subtotal = useMemo(() => Math.round(lineCalcs.reduce((s, c) => s + c.exclusiveBase, 0) * 100) / 100, [lineCalcs]);
  // Discounts entered line by line, kept apart from the invoice-level one so the
  // summary can show where the money went.
  const lineDiscountTotal = useMemo(
    () => Math.round(lines.reduce((s, l) => s + l.discount, 0) * 100) / 100,
    [lines],
  );
  const totalDiscount = Math.round((lineDiscountTotal + docDiscountApplied) * 100) / 100;
  // Gross line value, before any discount — the top of the summary ladder.
  const grossSubtotal = useMemo(
    () => Math.round(lines.reduce((s, l) => s + l.qty * l.rate, 0) * 100) / 100,
    [lines],
  );

  // Aggregate tax per code across lines for the footer ("one row per code")
  const taxByCode = useMemo(() => {
    const map = new Map<string, { code: string; rate: number; amount: number }>();
    for (const c of lineCalcs) {
      for (const t of c.taxes) {
        const e = map.get(t.taxCodeId) || { code: t.code, rate: t.rate, amount: 0 };
        e.amount = Math.round((e.amount + t.amount) * 100) / 100;
        map.set(t.taxCodeId, e);
      }
    }
    return [...map.values()];
  }, [lineCalcs]);

  const totalTax = useMemo(() => Math.round(taxByCode.reduce((s, t) => s + t.amount, 0) * 100) / 100, [taxByCode]);
  const total = Math.round((subtotal + totalTax) * 100) / 100;

  const handleSave = async (shouldPost = false) => {
    const typedNumber = invoiceNumber.trim();
    // The branch/QQQQ code is optional. The serial generator refuses a blank
    // one, so an unset branch falls back to MAIN — the same default the
    // quote→invoice conversion already uses, keeping single-branch tenants
    // from having to invent a code.
    const effectiveBranch = branchCode.trim() || "MAIN";
    if (!customerId) return toast.error("Please select a customer");
    if (typedNumber.length > 40) return toast.error("Invoice number cannot exceed 40 characters");
    if (lines.every((l) => l.rate === 0)) return toast.error("Add at least one line item");

    // Non-blocking warning: a posted line with an amount but no revenue account and no
    // product silently lands in the default sales account — a footgun for service firms.
    if (shouldPost) {
      const unmapped = lines.filter((l) => l.rate > 0 && !l.account_id && !l.product_id);
      if (unmapped.length > 0) {
        const proceed = window.confirm(
          `${unmapped.length} line(s) have no revenue account selected and will post to the ` +
            `default sales account. Continue posting?`,
        );
        if (!proceed) return;
      }
    }

    const setter = shouldPost ? setPosting : setSaving;
    setter(true);

    try {
      // The shared header payload — identical for create and edit. The serial
      // and tenant are only set on create (an edit keeps its existing number).
      const headerFields = {
        customer_id: customerId,
        issue_date: issueDate,
        due_date: dueDate || null,
        payment_terms: paymentTerms,
        date_of_supply: dateOfSupply || issueDate,
        place_of_supply: placeOfSupply.trim() || null,
        mode_of_payment: modeOfPayment || null,
        template_id: templateId || null,
        currency,
        exchange_rate: exchangeRate,
        // Store what the number actually carries: the fallback when we generated
        // the serial, otherwise only what the user typed.
        branch_code: branchCode.trim() || (typedNumber ? null : effectiveBranch),
        total_amount: total,
        subtotal,
        tax_amount: totalTax,
        discount_amount: totalDiscount,
        document_discount: docDiscountApplied,
        document_discount_percent: docDiscountPct,
        notes: notes || null,
        terms: terms || null,
        status: "draft",
      };

      let invoice: { id: string };

      if (isEdit) {
        // Edit an existing draft in place: update the header, then fully
        // replace its line items (drafts have no dependent GL/stock rows yet).
        // A blank number here means "keep the one it already has" rather than
        // renumber the draft — only a typed change moves it.
        const renumber = typedNumber && typedNumber !== originalNumber
          ? { invoice_number: typedNumber }
          : {};
        const { data: upd, error: updErr } = await supabase
          .from("invoices")
          .update({ ...headerFields, ...renumber } as any)
          .eq("id", editId!)
          .eq("status", "draft") // belt-and-braces: never touch a posted invoice
          .select()
          .single();
        if (updErr) throw updErr;
        if (!upd) throw new Error("Draft no longer editable (it may have been posted)");
        invoice = upd;
        setOriginalNumber(upd.invoice_number ?? originalNumber);
        setInvoiceNumber(upd.invoice_number ?? originalNumber);
        const { error: delErr } = await supabase.from("invoice_items").delete().eq("invoice_id", editId!);
        if (delErr) throw delErr;
      } else {
        // A typed number is used as entered. Otherwise generate the IRD-compliant
        // serial (YYMMM_QQQQ_XXXXX) atomically before the insert: the RPC bumps a
        // row-locked per-tenant/branch/month counter and records the number in the
        // serial register, so concurrent saves never collide and the sequence has
        // no unexplained gaps. A typed number sits outside that register.
        let serial = typedNumber;
        if (!serial) {
          const { data: generated, error: serialErr } = await supabase
            .rpc("next_invoice_serial", {
              p_branch_code: effectiveBranch,
              p_issue_date: issueDate,
            });
          if (serialErr || !generated) throw new Error(serialErr?.message || "Failed to generate invoice serial");
          serial = generated;
        }

        const { data: created, error: invErr } = await supabase
          .from("invoices")
          .insert({
            tenant_id: appUser?.tenant_id,
            invoice_number: serial,
            created_by: appUser?.id,
            ...headerFields,
          } as any)
          .select()
          .single();
        if (invErr) throw invErr;
        invoice = created;
        setInvoiceNumber(serial);
      }

      const itemInserts = lines
        .filter((l) => l.rate > 0 || l.description)
        .map((l) => ({
          invoice_id: invoice.id,
          description: l.description,
          quantity: l.qty,
          unit_price: l.rate,
          // total carries the line gross (incl. tax) for display; the server
          // recomputes tax from qty*unit_price - discount_amount + is_tax_inclusive
          total: lineCalcs[lines.indexOf(l)]?.lineTotal ?? l.qty * l.rate - l.discount,
          product_id: l.product_id || null,
          // Revenue account for this line; null → post-invoice falls back to defaultSalesId.
          // Do NOT set inventory_item_id here — the DB trigger snapshots it from the product
          // only when the product is tracked, so service lines correctly stay null.
          account_id: l.account_id || null,
          // Own discount plus this line's share of the invoice-level one: the
          // server recomputes tax and revenue from this figure, so the discount
          // has to be in it. The split is preserved in line_discount_amount.
          discount_amount: Math.round((l.discount + (docShares[lines.indexOf(l)] ?? 0)) * 100) / 100,
          line_discount_amount: l.discount,
          discount_percent: l.discount_pct,
          is_tax_inclusive: l.inclusive,
          tax_group_id: l.tax_sel.startsWith("g:") ? l.tax_sel.slice(2) : null,
          tax_code_id: l.tax_sel.startsWith("c:") ? l.tax_sel.slice(2) : null,
        }));

      if (itemInserts.length > 0) {
        const { error: itemErr } = await supabase.from("invoice_items").insert(itemInserts as any);
        if (itemErr) throw itemErr;
      }

      if (shouldPost) {
        await postInvoiceFn.mutateAsync({ invoice_id: invoice.id, action: "post" });
      } else {
        toast.success(isEdit ? "Draft updated" : "Invoice saved as draft");
      }

      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      navigate("/sales/invoices");
    } catch (err: any) {
      // (tenant_id, invoice_number) is unique — a typed number that's already in
      // use comes back as 23505, which reads as gibberish to the user.
      if (err?.code === "23505" || /duplicate key|unique constraint/i.test(err?.message || "")) {
        toast.error(`Invoice number "${invoiceNumber.trim()}" is already used — enter a different one`);
      } else {
        toast.error(err.message || "Failed to save invoice");
      }
    } finally {
      setter(false);
    }
  };

  const customer = customers?.find((c) => c.id === customerId);
  // A typed number is kept exactly as entered, but one that doesn't follow the
  // Gazette 2481/22 shape is worth flagging — it won't join the serial register
  // that accounts for the generated sequence.
  const numberIsGazette = /^\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)_.+_\d+$/.test(invoiceNumber.trim());
  const numberIsManual = !!invoiceNumber.trim() && invoiceNumber.trim() !== originalNumber;

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigate("/sales/invoices")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">{isEdit ? "Edit invoice" : "New invoice"}</h1>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Draft</span>
            </div>
            <p className="text-[13px] text-muted-foreground mt-0.5">Add lines, map each to a revenue account, and post a balanced entry.</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => handleSave(false)} disabled={saving || posting || loadingExisting}>
            <Save className="w-4 h-4 mr-1.5" />
            {saving ? "Saving…" : isEdit ? "Update draft" : "Save draft"}
          </Button>
          <Button size="sm" onClick={() => handleSave(true)} disabled={saving || posting || loadingExisting}>
            <Send className="w-4 h-4 mr-1.5" />
            {posting ? "Posting…" : "Save & post"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Main Form */}
        <div className="lg:col-span-4 space-y-6">
          {/* Customer & Dates */}
          <Card>
            <CardContent className="p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Customer</Label>
                  <div className="flex gap-2">
                    <Select value={customerId} onValueChange={setCustomerId}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select customer..." /></SelectTrigger>
                      <SelectContent>
                        {customers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <QuickCustomerDialog onCreated={(id) => setCustomerId(id)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Invoice number</Label>
                    {numberIsManual && (
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        onClick={() => setInvoiceNumber(originalNumber)}
                      >
                        {isEdit ? "Undo change" : "Use auto number"}
                      </button>
                    )}
                  </div>
                  <Input
                    className="h-9 font-mono"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    maxLength={40}
                    placeholder="Auto-generated on save"
                  />
                  {numberIsManual && !numberIsGazette ? (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400">
                      Saved exactly as typed. It doesn't follow the IRD format (YYMMM_QQQQ_XXXXX), so it
                      won't appear in the serial register.
                    </p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">
                      {isEdit
                        ? "Edit to renumber this draft, or leave it as it is."
                        : "Leave blank to generate one per IRD format (YYMMM_QQQQ_XXXXX), or type your own."}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Branch / Entity code (QQQQ)</Label>
                  <Input
                    className="h-9 font-mono"
                    value={branchCode}
                    onChange={(e) => setBranchCode(e.target.value)}
                    maxLength={15}
                    placeholder="e.g. BR03"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Optional. Used as the QQQQ segment of an auto-generated number; defaults to MAIN.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Date of supply</Label>
                  <DatePicker value={dateOfSupply || issueDate} onChange={setDateOfSupply} placeholder="Select date of supply" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Place of supply</Label>
                  <Input
                    className="h-9"
                    value={placeOfSupply}
                    onChange={(e) => setPlaceOfSupply(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Mode of payment</Label>
                  <Select value={modeOfPayment || MOP_NONE} onValueChange={(v) => setModeOfPayment(v === MOP_NONE ? "" : v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Not specified" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={MOP_NONE}>Not specified</SelectItem>
                      {MODE_OF_PAYMENT_OPTIONS.map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["LKR", "USD", "EUR", "GBP", "INR", "AUD", "SGD", "JPY", "AED"].map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {currency !== "LKR" && (
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Exchange rate (1 {currency} → LKR)</Label>
                    <Input
                      type="number"
                      className="h-9 font-mono"
                      value={exchangeRate || ""}
                      onChange={(e) => setExchangeRate(Number(e.target.value))}
                      min={0}
                      step="0.0001"
                    />
                    <p className="text-[10px] text-muted-foreground">GL posts in LKR at this rate. Set rates in Settings → Exchange Rates.</p>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Issue date</Label>
                  <DatePicker value={issueDate} onChange={setIssueDate} placeholder="Select issue date" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Payment terms</Label>
                  <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TERM_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Due date</Label>
                  <DatePicker value={dueDate} onChange={setDueDate} placeholder="Select due date" fromDate={issueDate} />
                </div>
              </div>
              {(invoiceTemplates?.length ?? 0) > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">PDF template</Label>
                    <Select value={templateId || TPL_DEFAULT} onValueChange={(v) => setTemplateId(v === TPL_DEFAULT ? "" : v)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={TPL_DEFAULT}>Default template</SelectItem>
                        {(invoiceTemplates || []).map((t: any) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.template_name}{t.is_default ? " (default)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground">Layout used when this invoice is downloaded as a PDF.</p>
                  </div>
                </div>
              )}
              {customer && (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  <p className="font-medium text-foreground">{customer.name}</p>
                  {customer.email && <p className="text-muted-foreground">{customer.email}</p>}
                  {customer.address && <p className="text-muted-foreground">{customer.address}</p>}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Line items</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Pick a product, or leave it blank for a service line and choose a revenue account.</p>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">{lines.length} line{lines.length === 1 ? "" : "s"}</span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border border-y border-border">
                {lines.map((line, idx) => {
                  const lineProduct = line.product_id ? productsById.get(line.product_id) : null;
                  const lineOnHand = onHandOf(lineProduct);
                  const lineCost = costOf(lineProduct);
                  const lineBadge = typeLabel(lineProduct);
                  // A line with no product is a service / ad-hoc line: it bills a flat
                  // amount against a chosen revenue account — no qty, no unit cost, no
                  // COGS leg. Selecting a product switches it back to a goods line.
                  const isService = !line.product_id;
                  const overStock = lineOnHand !== null && line.qty > lineOnHand;
                  // Gross margin % on the entered rate vs unit cost (stocked items only)
                  const marginPct = lineCost && line.rate > 0
                    ? Math.round(((line.rate - lineCost) / line.rate) * 100)
                    : null;
                  return (
                    <div key={line.id} className="group/line relative px-5 py-6 transition-colors hover:bg-muted/20">
                      {/* Row 1 — line number, description and product picker */}
                      <div className="flex items-start gap-3">
                        <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                          {idx + 1}
                        </span>
                        <div className="flex-1 space-y-2">
                          <div className="flex flex-col gap-2 sm:flex-row">
                            {/* Description, product picker and revenue account share the top row. */}
                            <Input className="h-10 min-w-0 flex-1 text-sm" placeholder="Description" value={line.description}
                              onChange={(e) => updateLine(line.id, "description", e.target.value)} />
                            <Select value={line.product_id || "none"}
                              onValueChange={(v) => updateLine(line.id, "product_id", v === "none" ? "" : v)}>
                              <SelectTrigger className="h-10 w-full shrink-0 text-xs sm:w-[170px]"><SelectValue placeholder="Link a product" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">— No product (service) —</SelectItem>
                                {products?.map((p: any) => {
                                  const oh = onHandOf(p);
                                  return (
                                    <SelectItem key={p.id} value={p.id}>
                                      {p.name}{oh !== null ? ` — ${oh} in stock` : ""}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            {/* Revenue account — auto-filled from the product's income account,
                                or pick one for an ad-hoc service line. */}
                            <Select value={line.account_id} onValueChange={(v) => updateLine(line.id, "account_id", v)}>
                              <SelectTrigger className="h-10 w-full shrink-0 text-xs sm:w-[190px]"><SelectValue placeholder="Revenue account…" /></SelectTrigger>
                              <SelectContent>
                                {revenueAccounts.map((a: any) => (
                                  <SelectItem key={a.id} value={a.id}>
                                    <span className="font-mono text-xs text-muted-foreground">{a.account_code}</span> {a.account_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {(lineBadge || lineOnHand !== null) && (
                            <div className="flex items-center gap-2">
                              {lineBadge && (
                                <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                  {lineBadge}
                                </span>
                              )}
                              {lineOnHand !== null && (
                                <span className={`text-[10px] ${overStock ? "text-destructive" : "text-muted-foreground"}`}>
                                  {lineOnHand} in stock
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="w-9 shrink-0">
                          {lines.length > 1 && (
                            <Button variant="ghost" size="icon" className="h-9 w-9 opacity-0 transition-opacity group-hover/line:opacity-100" onClick={() => removeLine(line.id)}>
                              <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Row 2 — the financial fields, each with its own label and breathing room */}
                      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 pl-9 sm:grid-cols-12">
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Qty</Label>
                          {isService ? (
                            // Service lines bill a flat amount; quantity is not applicable.
                            <div className="flex h-10 items-center justify-center rounded-md border border-dashed border-border">
                              <span className="text-xs text-muted-foreground/50">—</span>
                            </div>
                          ) : (
                            <Input type="number"
                              className={`h-10 text-sm text-center font-mono${overStock ? " border-destructive focus-visible:ring-destructive" : ""}`}
                              value={line.qty || ""}
                              onChange={(e) => updateLine(line.id, "qty", Number(e.target.value))} min={1} />
                          )}
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{isService ? "Amount" : "Rate"}</Label>
                          <Input type="number" className="h-10 text-sm text-right font-mono" placeholder="0.00"
                            value={line.rate || ""}
                            onChange={(e) => updateLine(line.id, "rate", Number(e.target.value))} min={0} />
                          {marginPct !== null && (
                            <p className={`text-[10px] text-right ${marginPct < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                              {marginPct}% margin
                            </p>
                          )}
                        </div>
                        {/* Discount — type a % and the money value is calculated from
                            qty × rate, or type the money value and the % follows. */}
                        <div className="col-span-2 space-y-1.5 sm:col-span-3">
                          <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Discount</Label>
                          <div className="flex items-center gap-1.5">
                            <div className="relative w-[44%] shrink-0">
                              <Input type="number" className="h-10 pr-5 text-sm text-right font-mono" placeholder="0"
                                value={line.discount_pct || ""} min={0} max={100} step="0.01"
                                onChange={(e) => updateLine(line.id, "discount_pct", Number(e.target.value))} />
                              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                            </div>
                            <Input type="number" className="h-10 min-w-0 flex-1 text-sm text-right font-mono" placeholder="0.00"
                              value={line.discount || ""} min={0}
                              onChange={(e) => updateLine(line.id, "discount", Number(e.target.value))} />
                          </div>
                          {line.discount > 0 && (
                            <p className="text-[10px] text-right text-muted-foreground">
                              −{formatCurrency(line.discount, currency)} off {formatCurrency(line.qty * line.rate, currency)}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1.5 sm:col-span-3">
                          <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tax</Label>
                          <Select value={line.tax_sel || "none"}
                            onValueChange={(v) => updateLine(line.id, "tax_sel", v === "none" ? "" : v)}>
                            <SelectTrigger className="h-10 text-sm"><SelectValue placeholder="No tax" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No Tax</SelectItem>
                              {sellableGroups.length > 0 && (
                                <SelectGroup>
                                  <SelectLabel>Groups</SelectLabel>
                                  {sellableGroups.map((g) => <SelectItem key={g.id} value={`g:${g.id}`}>{g.code}</SelectItem>)}
                                </SelectGroup>
                              )}
                              {sellableCodes.length > 0 && (
                                <SelectGroup>
                                  <SelectLabel>Codes</SelectLabel>
                                  {sellableCodes.map((c) => (
                                    <SelectItem key={c.id} value={`c:${c.id}`}>
                                      {c.code} ({currentRate(c, issueDate) ?? 0}%)
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              )}
                            </SelectContent>
                          </Select>
                          {line.tax_sel && (
                            <label className="flex items-center gap-1.5 pt-0.5 text-[10px] text-muted-foreground">
                              <Switch className="scale-75" checked={line.inclusive}
                                onCheckedChange={(v) => updateLine(line.id, "inclusive", v)} />
                              Tax inclusive
                            </label>
                          )}
                        </div>
                        <div className="col-span-2 space-y-1.5 sm:col-span-2">
                          <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:text-right sm:block">Amount</Label>
                          <div className="flex h-10 items-center justify-end font-mono tabular-nums text-base font-semibold text-foreground">
                            {formatCurrency(lineCalcs[idx]?.lineTotal ?? 0, currency)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="p-4">
                <Button variant="outline" size="sm" onClick={addLine} className="w-full border-dashed text-muted-foreground hover:text-foreground">
                  <Plus className="w-4 h-4 mr-1.5" /> Add line
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Notes & Terms */}
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <Label>Notes</Label>
                  <Textarea className="mt-1.5" rows={4} placeholder="Notes visible on invoice..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <div>
                  <Label>Terms &amp; Conditions</Label>
                  <Textarea className="mt-1.5" rows={4} placeholder="Payment terms..." value={terms} onChange={(e) => setTerms(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Totals & Journal Preview */}
        <div className="space-y-5 lg:sticky lg:top-6">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2.5">
              {/* Gross, then each deduction, then the taxable figure — so the
                  ladder reconciles down to the total the customer pays. */}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono tabular-nums text-foreground">{formatCurrency(grossSubtotal, currency)}</span>
              </div>
              {lineDiscountTotal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Line discounts</span>
                  <span className="font-mono tabular-nums text-destructive">-{formatCurrency(lineDiscountTotal, currency)}</span>
                </div>
              )}

              {/* Invoice-level discount — one figure off the whole invoice. It
                  comes off the taxable value, so the tax rows below react to it. */}
              <div className="space-y-1.5 rounded-md border border-dashed border-border p-2.5">
                <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Discount on total
                </Label>
                <div className="flex items-center gap-1.5">
                  <div className="relative w-[44%] shrink-0">
                    <Input type="number" className="h-9 pr-5 text-sm text-right font-mono" placeholder="0"
                      value={docDiscountPct || ""} min={0} max={100} step="0.01"
                      onChange={(e) => setDocPct(Number(e.target.value))} />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                  </div>
                  <Input type="number" className="h-9 min-w-0 flex-1 text-sm text-right font-mono" placeholder="0.00"
                    value={docDiscount || ""} min={0}
                    onChange={(e) => setDocAmount(Number(e.target.value))} />
                </div>
                {docDiscount > netTotal ? (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">
                    Capped at {formatCurrency(netTotal, currency)} — an invoice can't be discounted below zero.
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    Spread across the lines, so tax is charged on the discounted value.
                  </p>
                )}
              </div>

              {docDiscountApplied > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discount on total</span>
                  <span className="font-mono tabular-nums text-destructive">-{formatCurrency(docDiscountApplied, currency)}</span>
                </div>
              )}
              {totalDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Taxable amount</span>
                  <span className="font-mono tabular-nums text-foreground">{formatCurrency(subtotal, currency)}</span>
                </div>
              )}
              {/* One row per tax code */}
              {taxByCode.map((t) => (
                <div key={t.code} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.code} {t.rate}%</span>
                  <span className="font-mono tabular-nums text-foreground">{formatCurrency(t.amount, currency)}</span>
                </div>
              ))}
              <Separator />
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-foreground">Total</span>
                <span className="font-mono tabular-nums text-xl font-bold text-primary">{formatCurrency(total, currency)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Journal Preview */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Journal preview</CardTitle></CardHeader>
            <CardContent>
              {total > 0 ? (
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground truncate">Dr {arAccount?.account_name || "A/R"}</span>
                    <span className="font-mono tabular-nums shrink-0">{formatCurrency(total)}</span>
                  </div>
                  <div className="flex justify-between gap-2 pl-4">
                    <span className="text-muted-foreground truncate">Cr {revenueAccount?.account_name || "Revenue"}</span>
                    <span className="font-mono tabular-nums shrink-0">{formatCurrency(subtotal)}</span>
                  </div>
                  {taxByCode.map((t) => (
                    <div key={t.code} className="flex justify-between gap-2 pl-4">
                      <span className="text-muted-foreground truncate">Cr {t.code} Payable</span>
                      <span className="font-mono tabular-nums shrink-0">{formatCurrency(t.amount)}</span>
                    </div>
                  ))}
                  <Separator className="my-2" />
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Each tax code posts to its own liability account; the server recomputes tax and rejects mismatches.
                  </p>
                  {currency !== "LKR" && (
                    <p className="text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
                      Document is in {currency}; the GL posts in LKR at rate {exchangeRate} (≈ {formatCurrency(total * exchangeRate)}).
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Add line items to preview journal entries</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
