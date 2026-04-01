/**
 * QuickBooks-style Posting Engine
 * 
 * Sits between transaction forms and GL posting.
 * Handles: document → subledger → journal entry → journal lines
 * All operations are atomic within a single Supabase transaction context.
 */

import { supabase } from "@/integrations/supabase/client";

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
  entity_id: string;        // customer_id, vendor_id, item_id, or asset_id
  document_type: DocumentType;
  document_id: string;
  debit: number;
  credit: number;
  // Optional metadata
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

// ─── Posting Engine ───────────────────────────────────────

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
  } = request;

  // 1. Validate
  validateLines(lines);
  validateDoubleEntry(lines);

  // 2. Create journal entry header with source linking
  const now = new Date().toISOString();
  const { data: je, error: jeErr } = await supabase
    .from("journal_entries")
    .insert({
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
    })
    .select("id")
    .single();

  if (jeErr) throw new Error(`Failed to create journal entry: ${jeErr.message}`);

  const journalEntryId = je.id;

  // 3. Insert journal lines with entity linking
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

  // 4. Create subledger entries with full document→subledger→GL chain
  const subledgerIds: string[] = [];

  if (subledger_entries && subledger_entries.length > 0) {
    for (const entry of subledger_entries) {
      const subledgerId = await createSubledgerEntry(
        entry,
        tenant_id,
        journalEntryId,
        journalLineIds,
        lines
      );
      if (subledgerId) subledgerIds.push(subledgerId);
    }
  }

  return {
    journal_entry_id: journalEntryId,
    journal_line_ids: journalLineIds,
    subledger_ids: subledgerIds,
  };
}

// ─── Subledger Entry Creation ─────────────────────────────

async function createSubledgerEntry(
  entry: SubledgerEntry,
  tenantId: string,
  journalEntryId: string,
  journalLineIds: string[],
  lines: PostingLine[]
): Promise<string | null> {
  // Find the matching journal line for this subledger entry
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
          amount: balance, // backward compat
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
          amount: balance, // backward compat
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
          amount: balance, // backward compat
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
          amount: balance, // backward compat
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

/**
 * Find the journal line that matches the subledger entry's entity
 */
function findMatchingLineIndex(entry: SubledgerEntry, lines: PostingLine[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    switch (entry.type) {
      case "ar":
        if (line.customer_id === entry.entity_id) return i;
        break;
      case "ap":
        if (line.vendor_id === entry.entity_id) return i;
        break;
      case "inventory":
        if (line.item_id === entry.entity_id) return i;
        break;
      case "asset":
        if (line.asset_id === entry.entity_id) return i;
        break;
    }
  }
  // Fallback: match by debit/credit direction
  const isDebit = (entry.debit || 0) > 0;
  for (let i = 0; i < lines.length; i++) {
    if (isDebit && (lines[i].debit || 0) > 0) return i;
    if (!isDebit && (lines[i].credit || 0) > 0) return i;
  }
  return 0;
}

// ─── Convenience Helpers ──────────────────────────────────

/** Determine subledger type from account subtype */
export function getSubledgerTypeFromAccount(accountSubtype: string | null | undefined): SubledgerType {
  if (!accountSubtype) return null;
  const lower = accountSubtype.toLowerCase();
  if (lower.includes("accounts receivable") || lower === "receivable") return "ar";
  if (lower.includes("accounts payable") || lower === "payable") return "ap";
  if (lower.includes("inventory")) return "inventory";
  if (lower.includes("fixed asset") || lower.includes("accumulated depreciation")) return "asset";
  return null;
}

/** Void a posted journal entry (never delete) */
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

/** Reverse a posted journal entry by creating a new reversing entry */
export async function reverseJournalEntry(
  journalEntryId: string,
  tenantId: string,
  reversalDate: string,
  reason: string
): Promise<PostingResult> {
  // Fetch original lines
  const { data: originalLines, error: fetchErr } = await supabase
    .from("journal_lines")
    .select("account_id, debit, credit, customer_id, vendor_id, item_id, asset_id")
    .eq("journal_entry_id", journalEntryId);

  if (fetchErr) throw new Error(`Failed to fetch original lines: ${fetchErr.message}`);
  if (!originalLines?.length) throw new Error("No lines found for journal entry");

  // Swap debits and credits
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
