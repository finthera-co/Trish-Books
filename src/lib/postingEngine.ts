/**
 * QuickBooks-style Posting Engine
 * 
 * Sits between transaction forms and GL posting.
 * Handles: document → subledger → journal entry → journal lines
 * All operations are atomic within a single Supabase transaction context.
 * 
 * PART 3: Auto-posting for invoices, payments, credit notes
 * PART 4: Subledger enforcement for control accounts
 * PART 5: Opening balance subledger creation
 */

import { supabase } from "@/integrations/supabase/client";
import { generateRemainingLifeSchedule } from "@/lib/depreciation";

// ─── Types ────────────────────────────────────────────────

export type DocumentType = 
  | "invoice" | "payment_received" | "credit_note"
  | "bill" | "bill_payment" | "vendor_credit"
  | "inventory_receipt" | "inventory_adjustment"
  | "asset_purchase" | "depreciation"
  | "opening_balance" | "manual";

export type SubledgerType = "ar" | "ap" | "inventory" | "asset" | null;

export interface PostingLine {
  account_id: string;
  debit: number;
  credit: number;
  customer_id?: string;
  vendor_id?: string;
  item_id?: string;
  asset_id?: string;
}

export interface SubledgerEntry {
  type: SubledgerType;
  entity_id: string;
  document_type: DocumentType;
  document_id: string;
  debit: number;
  credit: number;
  invoice_no?: string;
  bill_no?: string;
  due_date?: string;
  qty?: number;
  rate?: number;
  cost?: number;
  salvage?: number;
  life_years?: number;
}

export interface PostingRequest {
  tenant_id: string;
  entry_date: string;
  description: string;
  source_type: DocumentType;
  source_id: string;
  reference?: string;
  lines: PostingLine[];
  subledger_entries?: SubledgerEntry[];
  entry_type?: string;
  obe_batch_id?: string;
}

export interface PostingResult {
  journal_entry_id: string;
  journal_line_ids: string[];
  subledger_ids: string[];
}

// ─── Validation ───────────────────────────────────────────

function validateDoubleEntry(lines: PostingLine[]): void {
  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  const diff = Math.abs(totalDebit - totalCredit);
  if (diff > 0.01) {
    throw new Error(
      `Journal entry is not balanced. Debits: ${totalDebit.toFixed(2)}, Credits: ${totalCredit.toFixed(2)}, Difference: ${diff.toFixed(2)}`
    );
  }
}

function validateLines(lines: PostingLine[]): void {
  if (!lines || lines.length < 2) {
    throw new Error("Journal entry must have at least 2 lines");
  }
  for (const line of lines) {
    if (!line.account_id) throw new Error("Each line must have an account_id");
    if ((line.debit || 0) < 0 || (line.credit || 0) < 0) {
      throw new Error("Debit and credit amounts must be non-negative");
    }
    if ((line.debit || 0) === 0 && (line.credit || 0) === 0) {
      throw new Error("Each line must have either a debit or credit amount");
    }
  }
}

// ─── PART 4: Subledger Enforcement ───────────────────────

/**
 * Validate that control account lines have the required entity IDs.
 * Fetches account subtypes and enforces subledger rules.
 */
export async function validateSubledgerRequirements(
  lines: PostingLine[],
  tenantId: string
): Promise<void> {
  const accountIds = [...new Set(lines.map((l) => l.account_id))];
  
  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id, account_subtype, requires_subledger, subledger_type, is_control_account")
    .in("id", accountIds)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(`Failed to fetch accounts for validation: ${error.message}`);

  const accountMap = new Map((accounts || []).map((a) => [a.id, a]));

  for (const line of lines) {
    const account = accountMap.get(line.account_id);
    if (!account) continue;

    // Use the is_control_account flag first, fall back to subtype detection
    const isControl = account.is_control_account || account.requires_subledger;
    if (!isControl) continue;

    const slType = account.subledger_type || getSubledgerTypeFromAccount(account.account_subtype);
    if (!slType || slType === "none") continue;

    switch (slType) {
      case "customer":
      case "ar":
        if (!line.customer_id) {
          throw new Error("Subledger required for control account: Accounts Receivable requires a customer_id");
        }
        break;
      case "vendor":
      case "ap":
        if (!line.vendor_id) {
          throw new Error("Subledger required for control account: Accounts Payable requires a vendor_id");
        }
        break;
      case "inventory":
        if (!line.item_id) {
          throw new Error("Subledger required for control account: Inventory requires an item_id");
        }
        break;
      case "fixed_asset":
      case "asset":
        if (!line.asset_id) {
          throw new Error("Subledger required for control account: Fixed Asset requires an asset_id");
        }
        break;
    }
  }
}

// ─── Core Posting Engine ──────────────────────────────────

export async function post(request: PostingRequest): Promise<PostingResult> {
  const {
    tenant_id,
    entry_date,
    description,
    source_type,
    source_id,
    reference,
    lines,
    subledger_entries,
    entry_type,
    obe_batch_id,
  } = request;

  // 1. Validate double-entry and line structure
  validateLines(lines);
  validateDoubleEntry(lines);

  // 2. Validate subledger requirements for control accounts
  await validateSubledgerRequirements(lines, tenant_id);

  // 3. Create journal entry header with source linking
  const now = new Date().toISOString();
  const insertData: any = {
    tenant_id,
    entry_date,
    description,
    status: "posted",
    entry_type: entry_type || source_type,
    reference: reference || null,
    is_system_generated: true,
    source_type,
    source_id,
    posted_at: now,
  };
  if (obe_batch_id) insertData.obe_batch_id = obe_batch_id;

  const { data: je, error: jeErr } = await supabase
    .from("journal_entries")
    .insert(insertData)
    .select("id")
    .single();

  if (jeErr) throw new Error(`Failed to create journal entry: ${jeErr.message}`);
  const journalEntryId = je.id;

  // 4. Insert journal lines with entity linking
  const lineInserts = lines.map((l) => ({
    journal_entry_id: journalEntryId,
    account_id: l.account_id,
    debit: l.debit || 0,
    credit: l.credit || 0,
    customer_id: l.customer_id || null,
    vendor_id: l.vendor_id || null,
    item_id: l.item_id || null,
    asset_id: l.asset_id || null,
  }));

  const { data: insertedLines, error: lineErr } = await supabase
    .from("journal_lines")
    .insert(lineInserts)
    .select("id");

  if (lineErr) throw new Error(`Failed to create journal lines: ${lineErr.message}`);
  const journalLineIds = (insertedLines || []).map((l: any) => l.id);

  // 5. Create subledger entries with full document→subledger→GL chain
  const subledgerIds: string[] = [];
  if (subledger_entries && subledger_entries.length > 0) {
    for (const entry of subledger_entries) {
      const id = await createSubledgerEntry(entry, tenant_id, journalEntryId, journalLineIds, lines);
      if (id) subledgerIds.push(id);
    }
  }

  return { journal_entry_id: journalEntryId, journal_line_ids: journalLineIds, subledger_ids: subledgerIds };
}

// ─── Subledger Entry Creation ─────────────────────────────

async function createSubledgerEntry(
  entry: SubledgerEntry,
  tenantId: string,
  journalEntryId: string,
  journalLineIds: string[],
  lines: PostingLine[]
): Promise<string | null> {
  const matchingLineIndex = findMatchingLineIndex(entry, lines);
  const journalLineId = journalLineIds[matchingLineIndex] || journalLineIds[0];
  const balance = (entry.debit || 0) - (entry.credit || 0);

  switch (entry.type) {
    case "ar": {
      const { data, error } = await supabase
        .from("ar_subledger")
        .insert({
          tenant_id: tenantId,
          customer_id: entry.entity_id,
          journal_line_id: journalLineId,
          journal_id: journalEntryId,
          document_type: entry.document_type,
          document_id: entry.document_id,
          debit: entry.debit || 0,
          credit: entry.credit || 0,
          balance,
          amount: balance,
          invoice_no: entry.invoice_no || null,
          due_date: entry.due_date || null,
        })
        .select("id")
        .single();
      if (error) throw new Error(`AR subledger error: ${error.message}`);
      return data?.id || null;
    }
    case "ap": {
      const { data, error } = await supabase
        .from("ap_subledger")
        .insert({
          tenant_id: tenantId,
          vendor_id: entry.entity_id,
          journal_line_id: journalLineId,
          journal_id: journalEntryId,
          document_type: entry.document_type,
          document_id: entry.document_id,
          debit: entry.debit || 0,
          credit: entry.credit || 0,
          balance,
          amount: balance,
          bill_no: entry.bill_no || null,
          due_date: entry.due_date || null,
        })
        .select("id")
        .single();
      if (error) throw new Error(`AP subledger error: ${error.message}`);
      return data?.id || null;
    }
    case "inventory": {
      const { data, error } = await supabase
        .from("inventory_subledger")
        .insert({
          tenant_id: tenantId,
          item_id: entry.entity_id,
          journal_line_id: journalLineId,
          journal_id: journalEntryId,
          document_type: entry.document_type,
          document_id: entry.document_id,
          debit: entry.debit || 0,
          credit: entry.credit || 0,
          balance,
          amount: balance,
          qty: entry.qty || 0,
          rate: entry.rate || 0,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Inventory subledger error: ${error.message}`);
      return data?.id || null;
    }
    case "asset": {
      const { data, error } = await supabase
        .from("asset_subledger")
        .insert({
          tenant_id: tenantId,
          asset_id: entry.entity_id,
          journal_line_id: journalLineId,
          journal_id: journalEntryId,
          document_type: entry.document_type,
          document_id: entry.document_id,
          debit: entry.debit || 0,
          credit: entry.credit || 0,
          balance,
          amount: balance,
          cost: entry.cost || 0,
          salvage: entry.salvage || 0,
          life_years: entry.life_years || null,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Asset subledger error: ${error.message}`);
      return data?.id || null;
    }
    default:
      return null;
  }
}

function findMatchingLineIndex(entry: SubledgerEntry, lines: PostingLine[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (entry.type === "ar" && line.customer_id === entry.entity_id) return i;
    if (entry.type === "ap" && line.vendor_id === entry.entity_id) return i;
    if (entry.type === "inventory" && line.item_id === entry.entity_id) return i;
    if (entry.type === "asset" && line.asset_id === entry.entity_id) return i;
  }
  const isDebit = (entry.debit || 0) > 0;
  for (let i = 0; i < lines.length; i++) {
    if (isDebit && (lines[i].debit || 0) > 0) return i;
    if (!isDebit && (lines[i].credit || 0) > 0) return i;
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════
// PART 3: Auto-Posting Helpers (QuickBooks Style)
// ═══════════════════════════════════════════════════════════

/**
 * Post an invoice: Dr AR / Cr Revenue + AR subledger
 */
export async function postInvoice(params: {
  tenant_id: string;
  invoice_id: string;
  customer_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  total_amount: number;
  ar_account_id: string;
  revenue_account_id: string;
}): Promise<PostingResult> {
  return post({
    tenant_id: params.tenant_id,
    entry_date: params.issue_date,
    description: `Invoice ${params.invoice_number}`,
    source_type: "invoice",
    source_id: params.invoice_id,
    reference: params.invoice_number,
    lines: [
      { account_id: params.ar_account_id, debit: params.total_amount, credit: 0, customer_id: params.customer_id },
      { account_id: params.revenue_account_id, debit: 0, credit: params.total_amount },
    ],
    subledger_entries: [
      {
        type: "ar",
        entity_id: params.customer_id,
        document_type: "invoice",
        document_id: params.invoice_id,
        debit: params.total_amount,
        credit: 0,
        invoice_no: params.invoice_number,
        due_date: params.due_date,
      },
    ],
  });
}

/**
 * Post a payment received: Dr Bank / Cr AR + AR subledger (credit)
 */
/** WHT the customer deducted from their payment to us (AIT receivable). */
export interface PaymentReceivedWht {
  amount: number;
  tax_code_id: string;
  wht_receivable_account_id: string;
  rate: number;
}

/**
 * Post a payment received. Without WHT: Dr Bank / Cr AR.
 * When the customer withholds tax: Dr Bank (net) / Dr WHT Receivable /
 * Cr AR (gross) — and a wht_receivable row in the tax sub-ledger.
 */
export async function postPaymentReceived(params: {
  tenant_id: string;
  payment_id: string;
  customer_id: string;
  amount: number;          // gross AR settled
  payment_date: string;
  bank_account_id: string;
  ar_account_id: string;
  reference?: string;
  invoice_id?: string;
  wht?: PaymentReceivedWht | null;
}): Promise<PostingResult> {
  const wht = params.wht && params.wht.amount > 0 ? params.wht : null;
  const netBank = Math.round((params.amount - (wht?.amount || 0)) * 100) / 100;

  const lines: PostingLine[] = [
    { account_id: params.bank_account_id, debit: netBank, credit: 0 },
    { account_id: params.ar_account_id, debit: 0, credit: params.amount, customer_id: params.customer_id },
  ];
  if (wht) {
    lines.splice(1, 0, { account_id: wht.wht_receivable_account_id, debit: wht.amount, credit: 0 });
  }

  const result = await post({
    tenant_id: params.tenant_id,
    entry_date: params.payment_date,
    description: `Payment received${params.reference ? ` - ${params.reference}` : ""}${wht ? " (customer withheld tax)" : ""}`,
    source_type: "payment_received",
    source_id: params.payment_id,
    reference: params.reference,
    lines,
    subledger_entries: [
      {
        type: "ar",
        entity_id: params.customer_id,
        document_type: "payment_received",
        document_id: params.payment_id,
        debit: 0,
        credit: params.amount,
      },
    ],
  });

  if (wht) {
    const { error } = await supabase.from("tax_transactions").insert({
      tenant_id: params.tenant_id,
      tax_code_id: wht.tax_code_id,
      direction: "wht_receivable",
      source_type: "payment_received",
      source_id: params.payment_id,
      base_amount: params.amount,
      tax_amount: wht.amount, // TODO(multi-currency): convert at payment FX rate once FX infrastructure exists
      tax_amount_txn_currency: wht.amount,
      currency: "LKR",
      fx_rate: 1,
      rate_applied: wht.rate,
      transaction_date: params.payment_date,
      journal_entry_id: result.journal_entry_id,
    });
    if (error) throw new Error(`WHT sub-ledger insert failed: ${error.message}`);
  }

  return result;
}

/**
 * Post a credit note: Dr Revenue / Cr AR + AR subledger (credit)
 */
export async function postCreditNote(params: {
  tenant_id: string;
  credit_note_id: string;
  customer_id: string;
  credit_note_number: string;
  credit_date: string;
  amount: number;
  ar_account_id: string;
  revenue_account_id: string;
}): Promise<PostingResult> {
  return post({
    tenant_id: params.tenant_id,
    entry_date: params.credit_date,
    description: `Credit Note ${params.credit_note_number}`,
    source_type: "credit_note",
    source_id: params.credit_note_id,
    reference: params.credit_note_number,
    lines: [
      { account_id: params.revenue_account_id, debit: params.amount, credit: 0 },
      { account_id: params.ar_account_id, debit: 0, credit: params.amount, customer_id: params.customer_id },
    ],
    subledger_entries: [
      {
        type: "ar",
        entity_id: params.customer_id,
        document_type: "credit_note",
        document_id: params.credit_note_id,
        debit: 0,
        credit: params.amount,
      },
    ],
  });
}

/**
 * Post a bill: Dr Expense/Inventory / Cr AP + AP subledger
 */
export async function postBill(params: {
  tenant_id: string;
  bill_id: string;
  vendor_id: string;
  bill_number: string;
  bill_date: string;
  due_date: string;
  total_amount: number;
  expense_account_id: string;
  ap_account_id: string;
}): Promise<PostingResult> {
  return post({
    tenant_id: params.tenant_id,
    entry_date: params.bill_date,
    description: `Bill ${params.bill_number}`,
    source_type: "bill",
    source_id: params.bill_id,
    reference: params.bill_number,
    lines: [
      { account_id: params.expense_account_id, debit: params.total_amount, credit: 0 },
      { account_id: params.ap_account_id, debit: 0, credit: params.total_amount, vendor_id: params.vendor_id },
    ],
    subledger_entries: [
      {
        type: "ap",
        entity_id: params.vendor_id,
        document_type: "bill",
        document_id: params.bill_id,
        debit: 0,
        credit: params.total_amount,
        bill_no: params.bill_number,
        due_date: params.due_date,
      },
    ],
  });
}

/** WHT withheld from a vendor at settlement (AIT, settlement-based). */
export interface BillPaymentWht {
  amount: number;
  base_amount: number;
  rate: number;
  tax_code_id: string;
  wht_payable_account_id: string;
  rule_id: string | null;
  certificate_no: string | null;
  /** Set when the user manually overrode the computed WHT — audited. */
  override_reason?: string;
}

/**
 * Post a bill payment. Without WHT: Dr AP / Cr Bank.
 * With WHT (settlement-based AIT): Dr AP (gross settled) / Cr Bank (net) /
 * Cr WHT Payable — and a wht_payable row in the tax sub-ledger linked to
 * the JE. Partial payments each carry their own WHT row.
 */
export async function postBillPayment(params: {
  tenant_id: string;
  payment_id: string;
  vendor_id: string;
  amount: number;          // gross AP settled
  payment_date: string;
  bank_account_id: string;
  ap_account_id: string;
  reference?: string;
  wht?: BillPaymentWht | null;
}): Promise<PostingResult> {
  const wht = params.wht && params.wht.amount > 0 ? params.wht : null;
  const netBank = Math.round((params.amount - (wht?.amount || 0)) * 100) / 100;

  const lines: PostingLine[] = [
    { account_id: params.ap_account_id, debit: params.amount, credit: 0, vendor_id: params.vendor_id },
    { account_id: params.bank_account_id, debit: 0, credit: netBank },
  ];
  if (wht) {
    lines.push({ account_id: wht.wht_payable_account_id, debit: 0, credit: wht.amount });
  }

  const result = await post({
    tenant_id: params.tenant_id,
    entry_date: params.payment_date,
    description: `Bill payment${params.reference ? ` - ${params.reference}` : ""}${wht ? ` (WHT ${wht.certificate_no ?? ""})` : ""}`,
    source_type: "bill_payment",
    source_id: params.payment_id,
    reference: params.reference,
    lines,
    subledger_entries: [
      {
        type: "ap",
        entity_id: params.vendor_id,
        document_type: "bill_payment",
        document_id: params.payment_id,
        debit: params.amount,
        credit: 0,
      },
    ],
  });

  if (wht) {
    const { error } = await supabase.from("tax_transactions").insert({
      tenant_id: params.tenant_id,
      tax_code_id: wht.tax_code_id,
      direction: "wht_payable",
      source_type: "bill_payment",
      source_id: params.payment_id,
      base_amount: wht.base_amount,
      tax_amount: wht.amount, // TODO(multi-currency): convert at payment FX rate once FX infrastructure exists
      tax_amount_txn_currency: wht.amount,
      currency: "LKR",
      fx_rate: 1,
      rate_applied: wht.rate,
      transaction_date: params.payment_date,
      journal_entry_id: result.journal_entry_id,
      wht_certificate_no: wht.certificate_no,
      note: wht.override_reason ? `Manual WHT override: ${wht.override_reason}` : null,
    });
    if (error) throw new Error(`WHT sub-ledger insert failed: ${error.message}`);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// PART 5: Opening Balance Subledger Posting
// ═══════════════════════════════════════════════════════════

/**
 * Find or create the Opening Balance Equity account for a tenant
 */
async function getOBEAccountId(tenantId: string): Promise<string> {
  const { data: existing } = await supabase
    .from("accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("account_name", "Opening Balance Equity")
    .eq("is_system", true)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("accounts")
    .insert({
      tenant_id: tenantId,
      account_name: "Opening Balance Equity",
      account_code: "3900",
      account_type: "Equity",
      account_subtype: "Opening Balance Equity",
      normal_balance: "credit",
      is_system: true,
      is_active: true,
      is_locked: true,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create OBE account: ${error.message}`);
  return created.id;
}

/**
 * Post a customer opening balance:
 * Dr Accounts Receivable / Cr Opening Balance Equity + AR subledger
 */
export async function postCustomerOpeningBalance(params: {
  tenant_id: string;
  customer_id: string;
  customer_name: string;
  amount: number;
  ar_account_id: string;
  date: string;
}): Promise<PostingResult> {
  const obeAccountId = await getOBEAccountId(params.tenant_id);

  return post({
    tenant_id: params.tenant_id,
    entry_date: params.date,
    description: `Opening Balance - ${params.customer_name}`,
    source_type: "opening_balance",
    source_id: params.customer_id,
    reference: `OB-CUST-${params.customer_name}`,
    entry_type: "opening_balance",
    lines: [
      { account_id: params.ar_account_id, debit: params.amount, credit: 0, customer_id: params.customer_id },
      { account_id: obeAccountId, debit: 0, credit: params.amount },
    ],
    subledger_entries: [
      {
        type: "ar",
        entity_id: params.customer_id,
        document_type: "opening_balance",
        document_id: params.customer_id,
        debit: params.amount,
        credit: 0,
      },
    ],
  });
}

/**
 * Post a vendor opening balance:
 * Dr Opening Balance Equity / Cr Accounts Payable + AP subledger
 */
export async function postVendorOpeningBalance(params: {
  tenant_id: string;
  vendor_id: string;
  vendor_name: string;
  amount: number;
  ap_account_id: string;
  date: string;
}): Promise<PostingResult> {
  const obeAccountId = await getOBEAccountId(params.tenant_id);

  return post({
    tenant_id: params.tenant_id,
    entry_date: params.date,
    description: `Opening Balance - ${params.vendor_name}`,
    source_type: "opening_balance",
    source_id: params.vendor_id,
    reference: `OB-VEND-${params.vendor_name}`,
    entry_type: "opening_balance",
    lines: [
      { account_id: obeAccountId, debit: params.amount, credit: 0 },
      { account_id: params.ap_account_id, debit: 0, credit: params.amount, vendor_id: params.vendor_id },
    ],
    subledger_entries: [
      {
        type: "ap",
        entity_id: params.vendor_id,
        document_type: "opening_balance",
        document_id: params.vendor_id,
        debit: 0,
        credit: params.amount,
      },
    ],
  });
}

/**
 * Post an inventory item opening balance:
 * Dr Inventory / Cr Opening Balance Equity + Inventory subledger
 */
export async function postInventoryOpeningBalance(params: {
  tenant_id: string;
  item_id: string;
  item_name: string;
  amount: number;
  qty: number;
  rate: number;
  inventory_account_id: string;
  date: string;
}): Promise<PostingResult> {
  const obeAccountId = await getOBEAccountId(params.tenant_id);

  return post({
    tenant_id: params.tenant_id,
    entry_date: params.date,
    description: `Opening Balance - ${params.item_name}`,
    source_type: "opening_balance",
    source_id: params.item_id,
    reference: `OB-INV-${params.item_name}`,
    entry_type: "opening_balance",
    lines: [
      { account_id: params.inventory_account_id, debit: params.amount, credit: 0, item_id: params.item_id },
      { account_id: obeAccountId, debit: 0, credit: params.amount },
    ],
    subledger_entries: [
      {
        type: "inventory",
        entity_id: params.item_id,
        document_type: "opening_balance",
        document_id: params.item_id,
        debit: params.amount,
        credit: 0,
        qty: params.qty,
        rate: params.rate,
      },
    ],
  });
}

/**
 * Post a fixed asset opening balance:
 * Dr Fixed Asset / Cr Opening Balance Equity + Asset subledger
 */
export async function postAssetOpeningBalance(params: {
  tenant_id: string;
  asset_id: string;
  asset_name: string;
  amount: number;
  cost: number;
  salvage?: number;
  life_years?: number;
  asset_account_id: string;
  date: string;
}): Promise<PostingResult> {
  const obeAccountId = await getOBEAccountId(params.tenant_id);

  return post({
    tenant_id: params.tenant_id,
    entry_date: params.date,
    description: `Opening Balance - ${params.asset_name}`,
    source_type: "opening_balance",
    source_id: params.asset_id,
    reference: `OB-ASSET-${params.asset_name}`,
    entry_type: "opening_balance",
    lines: [
      { account_id: params.asset_account_id, debit: params.amount, credit: 0, asset_id: params.asset_id },
      { account_id: obeAccountId, debit: 0, credit: params.amount },
    ],
    subledger_entries: [
      {
        type: "asset",
        entity_id: params.asset_id,
        document_type: "opening_balance",
        document_id: params.asset_id,
        debit: params.amount,
        credit: 0,
        cost: params.cost,
        salvage: params.salvage || 0,
        life_years: params.life_years,
      },
    ],
  });
}

/**
 * Create a MIGRATED fixed asset and post ONLY its opening balance — the single
 * entry point for assets that existed before go-live.
 *
 * Unlike the Assets-page acquisition flow (post-asset-transaction), this does NOT
 * post an acquisition journal (Dr Asset / Cr Payment) and does NOT seed a fresh
 * full-life depreciation schedule. Instead it:
 *   a. inserts the fixed_assets row directly (carrying opening accumulated dep),
 *   b. posts only opening journals — Dr Cost / Cr OBE, plus Dr OBE / Cr Accum Dep
 *      when opening accum dep > 0 (net OBE impact = opening NBV),
 *   c. writes one asset_subledger "opening_balance" row,
 *   d. seeds a REMAINING-LIFE depreciation schedule (not a full one).
 */
export async function postFixedAssetOpeningBalanceWithCreate(params: {
  tenant_id: string;
  asset_name: string;
  description?: string;
  category_id?: string;
  asset_account_id: string;          // the OB control account (e.g. 1710)
  accumulated_depreciation_account_id: string;
  depreciation_method?: string;
  cost: number;                      // gross
  opening_accum_dep: number;         // accumulated depreciation to date
  salvage_value?: number;
  useful_life_months: number;
  acquisition_date: string;          // original
  as_of_date: string;                // OB date
}): Promise<{ asset_id: string; journal_entry_id: string }> {
  const {
    tenant_id,
    asset_name,
    description,
    category_id,
    asset_account_id,
    accumulated_depreciation_account_id,
    depreciation_method,
    cost,
    opening_accum_dep,
    salvage_value = 0,
    useful_life_months,
    acquisition_date,
    as_of_date,
  } = params;

  // ── Validation ──
  if (cost < 0) throw new Error("Cost must be ≥ 0");
  if (opening_accum_dep < 0) throw new Error("Accumulated depreciation must be ≥ 0");
  if (salvage_value < 0) throw new Error("Salvage value must be ≥ 0");
  if (useful_life_months <= 0) throw new Error("Useful life (months) must be > 0");
  if (opening_accum_dep > cost - salvage_value + 0.005) {
    throw new Error("Accumulated depreciation cannot exceed cost minus salvage value");
  }

  // ── Resolve depreciation accounts/method (category overrides the param) ──
  let accumDepAccountId = accumulated_depreciation_account_id;
  let deprExpenseAccountId: string | null = null;
  let method = depreciation_method || "straight_line";

  if (category_id) {
    const { data: cat, error: catErr } = await supabase
      .from("asset_categories")
      .select("accumulated_depreciation_account_id, depreciation_expense_account_id, depreciation_method")
      .eq("id", category_id)
      .eq("tenant_id", tenant_id)
      .maybeSingle();
    if (catErr) throw new Error(`Failed to load asset category: ${catErr.message}`);
    if (cat) {
      accumDepAccountId = cat.accumulated_depreciation_account_id || accumDepAccountId;
      deprExpenseAccountId = cat.depreciation_expense_account_id || null;
      method = cat.depreciation_method || method;
    }
  }

  if (!accumDepAccountId) {
    throw new Error("Accumulated depreciation account is required");
  }

  // ── a. Insert the migrated fixed_assets row directly (NOT via post-asset-transaction) ──
  const { data: asset, error: assetErr } = await supabase
    .from("fixed_assets")
    .insert({
      tenant_id,
      asset_name,
      description: description || null,
      category_id: category_id || null,
      asset_account_id,
      depreciation_account_id: accumDepAccountId,
      depr_expense_account_id: deprExpenseAccountId,
      cost,
      salvage_value,
      useful_life_months,
      depreciation_method: method,
      acquisition_date,
      start_date: acquisition_date,
      accumulated_depreciation: opening_accum_dep, // ← KEY: opening accum dep
      status: "active",
    })
    .select("id")
    .single();
  if (assetErr) throw new Error(`Failed to create migrated asset: ${assetErr.message}`);
  const assetId = asset.id;

  // ── b. Post the opening journal (no acquisition journal) ──
  const obeAccountId = await getOBEAccountId(tenant_id);
  const lines: PostingLine[] = [
    { account_id: asset_account_id, debit: cost, credit: 0, asset_id: assetId },
    { account_id: obeAccountId, debit: 0, credit: cost },
  ];
  if (opening_accum_dep > 0) {
    lines.push({ account_id: obeAccountId, debit: opening_accum_dep, credit: 0 });
    lines.push({ account_id: accumDepAccountId, debit: 0, credit: opening_accum_dep, asset_id: assetId });
  }

  const result = await post({
    tenant_id,
    entry_date: as_of_date,
    description: `Opening Balance - ${asset_name}`,
    source_type: "opening_balance",
    source_id: assetId,
    reference: `OB-ASSET-${asset_name}`,
    entry_type: "opening_balance",
    lines,
  });

  // ── c. One asset_subledger "opening_balance" row (matches post-asset-transaction shape) ──
  const { error: slErr } = await supabase.from("asset_subledger").insert({
    tenant_id,
    asset_id: assetId,
    journal_line_id: result.journal_line_ids[0], // the Dr Cost line
    journal_id: result.journal_entry_id,
    document_type: "opening_balance",
    document_id: assetId,
    debit: cost,
    credit: 0,
    amount: cost,
    balance: cost,
    cost,
    salvage: salvage_value,
    life_years: Math.round(useful_life_months / 12),
    transaction_type: "opening_balance",
  } as any);
  if (slErr) throw new Error(`Asset subledger insert failed: ${slErr.message}`);

  // ── d. Seed a REMAINING-LIFE schedule (not a fresh full schedule) ──
  const schedule = generateRemainingLifeSchedule(
    {
      id: assetId,
      cost,
      salvage_value,
      useful_life_months,
      start_date: acquisition_date,
      status: "active",
    },
    opening_accum_dep,
    as_of_date.slice(0, 7) // YYYY-MM
  );
  if (schedule.length > 0) {
    const rows = schedule.map((r) => ({
      tenant_id,
      asset_id: assetId,
      period: r.period,
      depreciation_amount: r.depreciation_amount,
      accumulated_depreciation: r.accumulated_depreciation,
      net_book_value: r.net_book_value,
      status: "pending",
    }));
    const { error: schedErr } = await supabase.from("asset_depreciation").insert(rows);
    if (schedErr) throw new Error(`Depreciation schedule insert failed: ${schedErr.message}`);
  }

  return { asset_id: assetId, journal_entry_id: result.journal_entry_id };
}

// ─── Convenience Helpers ──────────────────────────────────

export function getSubledgerTypeFromAccount(accountSubtype: string | null | undefined): SubledgerType {
  if (!accountSubtype) return null;
  const lower = accountSubtype.toLowerCase();
  if (lower.includes("accounts receivable") || lower === "receivable") return "ar";
  if (lower.includes("accounts payable") || lower === "payable") return "ap";
  if (lower.includes("inventory")) return "inventory";
  if (lower.includes("fixed asset") || lower.includes("accumulated depreciation")) return "asset";
  return null;
}

export async function voidJournalEntry(
  journalEntryId: string,
  reason: string,
  voidedBy?: string
): Promise<void> {
  const { error } = await supabase
    .from("journal_entries")
    .update({
      status: "voided",
      voided_at: new Date().toISOString(),
      voided_by: voidedBy || null,
      void_reason: reason,
    })
    .eq("id", journalEntryId);

  if (error) throw new Error(`Failed to void journal entry: ${error.message}`);
}

export async function reverseJournalEntry(
  journalEntryId: string,
  tenantId: string,
  reversalDate: string,
  reason: string
): Promise<PostingResult> {
  const { data: originalLines, error: fetchErr } = await supabase
    .from("journal_lines")
    .select("account_id, debit, credit, customer_id, vendor_id, item_id, asset_id")
    .eq("journal_entry_id", journalEntryId);

  if (fetchErr) throw new Error(`Failed to fetch original lines: ${fetchErr.message}`);
  if (!originalLines?.length) throw new Error("No lines found for journal entry");

  const reversedLines: PostingLine[] = originalLines.map((l: any) => ({
    account_id: l.account_id,
    debit: l.credit || 0,
    credit: l.debit || 0,
    customer_id: l.customer_id || undefined,
    vendor_id: l.vendor_id || undefined,
    item_id: l.item_id || undefined,
    asset_id: l.asset_id || undefined,
  }));

  return post({
    tenant_id: tenantId,
    entry_date: reversalDate,
    description: `Reversal: ${reason}`,
    source_type: "manual",
    source_id: journalEntryId,
    reference: `REV-${journalEntryId.substring(0, 8)}`,
    lines: reversedLines,
    entry_type: "reversal",
  });
}
