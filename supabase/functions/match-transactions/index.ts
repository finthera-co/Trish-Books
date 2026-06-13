import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { executeRuleAction, ruleConditionMatches, ruleWillPost } from "../_shared/ruleActions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ───
interface BankFeed {
  id: string;
  transaction_date: string;
  description: string;
  amount: number;
  reference_number: string | null;
}

interface LedgerEntry {
  recon_txn_id: string;
  journal_line_id: string;
  entry_date: string;
  description: string;
  reference: string | null;
  source_type: string | null;
  source_id: string | null;
  debit: number;
  credit: number;
  net_amount: number;
}

interface MatchResult {
  bank_feed_id: string;
  recon_txn_ids: string[];
  journal_line_ids: string[];
  confidence: number;
  method: string;
  match_type: string;
  reasons: string[];
}

// ─── Utility: Trigram similarity ───
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const sa = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const sb = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (sa === sb) return 1;
  if (sa.includes(sb) || sb.includes(sa)) return 0.7;
  const triA = new Set<string>();
  const triB = new Set<string>();
  for (let i = 0; i <= sa.length - 3; i++) triA.add(sa.slice(i, i + 3));
  for (let i = 0; i <= sb.length - 3; i++) triB.add(sb.slice(i, i + 3));
  if (triA.size === 0 || triB.size === 0) return 0;
  let inter = 0;
  triA.forEach((t) => { if (triB.has(t)) inter++; });
  return inter / (triA.size + triB.size - inter);
}

// ─── Step 1: Period Lock Check ───
async function checkPeriodLock(supabase: any, tenantId: string, statementDate: string): Promise<string | null> {
  const { data } = await supabase
    .from("fiscal_periods")
    .select("id, name, status")
    .eq("tenant_id", tenantId)
    .eq("status", "closed")
    .lte("period_start", statementDate)
    .gte("period_end", statementDate)
    .limit(1);
  if (data && data.length > 0) {
    return `Period "${data[0].name}" is closed. Cannot run matching on closed periods.`;
  }
  return null;
}

// ─── Step 2: Rule Engine (runs FIRST) ───
// Uses the SHARED rule engine (../_shared/ruleActions.ts) so the primary
// "AI Match" path executes rule actions with EXACTLY the same logic as
// "Engine Match". When a rule with action_create_expense=true (+ account) fires
// on an unmatched line, executeRuleAction posts a balanced JE and clears it
// (RULE_AUTO). Rules without the create-expense action keep the legacy
// rule_matched stamp (suggest-only; behaviour unchanged).
async function applyRules(
  supabase: any,
  recon: { id: string; tenant_id: string; bank_account_id: string },
  bankFeeds: BankFeed[],
  usedBank: Set<string>
): Promise<{ applied: number; posted: number; ruleMatchedIds: Set<string> }> {
  const { data: rules } = await supabase
    .from("reconciliation_rules")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: false });

  let applied = 0;
  let posted = 0;
  const ruleMatchedIds = new Set<string>();

  for (const bf of bankFeeds) {
    if (usedBank.has(bf.id)) continue;
    for (const rule of (rules || [])) {
      if (!ruleConditionMatches(rule, bf as any)) continue;

      if (ruleWillPost(rule)) {
        const outcome = await executeRuleAction(supabase, recon, bf as any, rule);
        if (outcome.kind === "posted") {
          usedBank.add(bf.id);
          ruleMatchedIds.add(bf.id);
          applied++;
          posted++;
          break;
        }
        // Gate/guard blocked posting (sign mismatch, locked period, missing tax
        // account…): leave it as a suggestion with the reason so it's flagged for
        // review instead of silently auto-clearing.
        await supabase
          .from("bank_feed_transactions")
          .update({
            status: "suggested",
            match_type: "RULE_ONLY",
            match_metadata: {
              method: "rule",
              reasons: [`Rule "${rule.name}" matched but not auto-posted: ${outcome.reason}`],
              rule_id: rule.id,
              timestamp: new Date().toISOString(),
            },
          })
          .eq("id", bf.id);
        usedBank.add(bf.id);
        ruleMatchedIds.add(bf.id);
        applied++;
        break;
      }

      await supabase
        .from("bank_feed_transactions")
        .update({
          status: "rule_matched",
          match_type: "rule",
          match_metadata: {
            method: "rule",
            confidence: 100,
            reasons: [`Rule "${rule.name}" matched`],
            timestamp: new Date().toISOString(),
            rule_id: rule.id,
          },
        })
        .eq("id", bf.id);
      usedBank.add(bf.id);
      ruleMatchedIds.add(bf.id);
      applied++;
      break;
    }
  }
  return { applied, posted, ruleMatchedIds };
}

// ─── Step 3: Source-Based Matching (100% confidence) ───
function sourceMatch(
  bankFeeds: BankFeed[],
  ledgerEntries: LedgerEntry[],
  usedBank: Set<string>,
  usedLedger: Set<string>
): MatchResult[] {
  const results: MatchResult[] = [];

  for (const bf of bankFeeds) {
    if (usedBank.has(bf.id)) continue;
    if (!bf.reference_number) continue;

    const refNorm = bf.reference_number.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const le of ledgerEntries) {
      if (usedLedger.has(le.recon_txn_id)) continue;

      // Match by external_ref / reference
      const leRef = (le.reference || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const amountMatch = Math.abs(Math.abs(bf.amount) - Math.abs(le.net_amount)) < 0.01;

      if (amountMatch && refNorm && leRef && (refNorm === leRef || refNorm.includes(leRef) || leRef.includes(refNorm))) {
        results.push({
          bank_feed_id: bf.id,
          recon_txn_ids: [le.recon_txn_id],
          journal_line_ids: [le.journal_line_id],
          confidence: 100,
          method: "source",
          match_type: "AUTO_MATCHED",
          reasons: [`Reference match: "${bf.reference_number}" ↔ "${le.reference}"`, "Amount exact match"],
        });
        usedBank.add(bf.id);
        usedLedger.add(le.recon_txn_id);
        break;
      }

      // Match by source_id if bank ref contains it
      if (le.source_id && refNorm.includes(le.source_id.replace(/-/g, "").substring(0, 8))) {
        if (amountMatch) {
          results.push({
            bank_feed_id: bf.id,
            recon_txn_ids: [le.recon_txn_id],
            journal_line_ids: [le.journal_line_id],
            confidence: 100,
            method: "source",
            match_type: "AUTO_MATCHED",
            reasons: [`Source ID match: ${le.source_type}/${le.source_id}`, "Amount exact match"],
          });
          usedBank.add(bf.id);
          usedLedger.add(le.recon_txn_id);
          break;
        }
      }
    }
  }
  return results;
}

// ─── Step 4: Module Resolver (AR/AP/Payroll/Tax/Asset) ───
function moduleResolve(
  bankFeeds: BankFeed[],
  ledgerEntries: LedgerEntry[],
  usedBank: Set<string>,
  usedLedger: Set<string>
): MatchResult[] {
  const results: MatchResult[] = [];
  const moduleKeywords: Record<string, string[]> = {
    invoice: ["inv", "invoice", "payment received", "customer payment"],
    bill: ["bill", "vendor payment", "supplier", "purchase"],
    payroll: ["salary", "payroll", "wage", "compensation", "epf", "etf"],
    tax: ["tax", "vat", "gst", "withholding", "irs", "hmrc"],
    asset: ["asset", "equipment", "machinery", "vehicle", "furniture"],
  };

  for (const bf of bankFeeds) {
    if (usedBank.has(bf.id)) continue;
    const descLower = (bf.description || "").toLowerCase();
    const bankAmt = Math.abs(bf.amount);

    for (const le of ledgerEntries) {
      if (usedLedger.has(le.recon_txn_id)) continue;
      if (Math.abs(bankAmt - Math.abs(le.net_amount)) > 0.01) continue;

      // Check if source_type matches known modules
      const srcType = (le.source_type || "").toLowerCase();
      let moduleMatch: string | null = null;

      for (const [mod, keywords] of Object.entries(moduleKeywords)) {
        if (srcType.includes(mod) || keywords.some(k => descLower.includes(k) || srcType.includes(k))) {
          moduleMatch = mod;
          break;
        }
      }

      if (moduleMatch) {
        const dateDiff = Math.abs(new Date(bf.transaction_date).getTime() - new Date(le.entry_date).getTime()) / 86400000;
        if (dateDiff <= 5) {
          results.push({
            bank_feed_id: bf.id,
            recon_txn_ids: [le.recon_txn_id],
            journal_line_ids: [le.journal_line_id],
            confidence: 95,
            method: "module",
            match_type: "AUTO_MATCHED",
            reasons: [`Module: ${moduleMatch}`, `Source: ${le.source_type || "GL"}`, "Amount exact match", `Date proximity: ${dateDiff}d`],
          });
          usedBank.add(bf.id);
          usedLedger.add(le.recon_txn_id);
          break;
        }
      }
    }
  }
  return results;
}

// ─── Step 5: One-to-Many / Many-to-One Combination Matching ───
function comboMatch(
  bankFeeds: BankFeed[],
  ledgerEntries: LedgerEntry[],
  usedBank: Set<string>,
  usedLedger: Set<string>
): MatchResult[] {
  const results: MatchResult[] = [];
  const MAX_COMBO = 5;
  const TOLERANCE = 0.01;

  // One bank → many ledger
  for (const bf of bankFeeds) {
    if (usedBank.has(bf.id)) continue;
    const target = Math.abs(bf.amount);

    // Get available ledger entries within date range
    const candidates = ledgerEntries.filter(le =>
      !usedLedger.has(le.recon_txn_id) &&
      Math.abs(new Date(bf.transaction_date).getTime() - new Date(le.entry_date).getTime()) / 86400000 <= 7
    );

    // Try combinations of 2..MAX_COMBO
    for (let size = 2; size <= Math.min(MAX_COMBO, candidates.length); size++) {
      const found = findCombination(candidates, target, size, TOLERANCE);
      if (found) {
        results.push({
          bank_feed_id: bf.id,
          recon_txn_ids: found.map(l => l.recon_txn_id),
          journal_line_ids: found.map(l => l.journal_line_id),
          confidence: 88,
          method: "combo",
          match_type: "GROUP_MATCHED",
          reasons: [`1 bank txn → ${found.length} GL entries`, `Sum matches within ${TOLERANCE}`],
        });
        usedBank.add(bf.id);
        found.forEach(l => usedLedger.add(l.recon_txn_id));
        break;
      }
    }
  }
  return results;
}

function findCombination(entries: LedgerEntry[], target: number, size: number, tolerance: number): LedgerEntry[] | null {
  if (entries.length < size) return null;

  function backtrack(start: number, remaining: number, current: LedgerEntry[], sum: number): LedgerEntry[] | null {
    if (remaining === 0) {
      return Math.abs(sum - target) <= tolerance ? [...current] : null;
    }
    for (let i = start; i < entries.length; i++) {
      const amt = Math.abs(entries[i].net_amount);
      if (sum + amt > target + tolerance) continue;
      current.push(entries[i]);
      const result = backtrack(i + 1, remaining - 1, current, sum + amt);
      if (result) return result;
      current.pop();
    }
    return null;
  }

  return backtrack(0, size, [], 0);
}

// ─── Step 6: AR Inference Engine (QuickBooks-style payment intent) ───
// Matches positive bank inflows to OPEN/PARTIAL invoices using multi-signal scoring.
// On high confidence (>=95) creates a payments_received record + JE automatically.
interface OpenInvoice {
  id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  total_amount: number;
  balance_due: number;
  issue_date: string;
  ar_account_id: string | null;
  status: string;
}

const PAYMENT_INTENT_KEYWORDS = [
  "payment", "paid", "received", "deposit", "transfer", "remit",
  "settlement", "inv", "invoice", "ref", "txn", "neft", "rtgs", "ach", "wire",
];

function detectPaymentIntent(desc: string, amount: number): boolean {
  if (amount <= 0) return false; // outflows excluded
  const d = (desc || "").toLowerCase();
  // Default: any positive inflow is a possible payment unless clearly a fee/charge/interest
  if (/(fee|charge|interest earned|service charge)/.test(d)) return false;
  return true;
}

async function fetchOpenInvoices(supabase: any, tenantId: string): Promise<OpenInvoice[]> {
  // Fetch posted/sent/partial invoices with customers
  const { data: invs } = await supabase
    .from("invoices")
    .select("id, invoice_number, customer_id, total_amount, issue_date, ar_account_id, status, customers(name)")
    .eq("tenant_id", tenantId)
    .in("status", ["posted", "sent", "partial"]);
  if (!invs || invs.length === 0) return [];

  // Compute balance_due via payments_received
  const ids = invs.map((i: any) => i.id);
  const { data: pmts } = await supabase
    .from("payments_received")
    .select("invoice_id, amount")
    .in("invoice_id", ids);
  const paidMap = new Map<string, number>();
  (pmts || []).forEach((p: any) => {
    paidMap.set(p.invoice_id, (paidMap.get(p.invoice_id) || 0) + Number(p.amount));
  });

  return invs
    .map((i: any) => {
      const total = Number(i.total_amount) || 0;
      const paid = paidMap.get(i.id) || 0;
      return {
        id: i.id,
        invoice_number: i.invoice_number,
        customer_id: i.customer_id,
        customer_name: i.customers?.name || "",
        total_amount: total,
        balance_due: total - paid,
        issue_date: i.issue_date,
        ar_account_id: i.ar_account_id,
        status: i.status,
      } as OpenInvoice;
    })
    .filter((i: OpenInvoice) => i.balance_due > 0.01);
}

function scoreInvoiceMatch(bf: BankFeed, inv: OpenInvoice): { score: number; reasons: string[]; partial: boolean } {
  const reasons: string[] = [];
  let score = 0;
  const bankAmt = Math.abs(bf.amount);
  const desc = (bf.description || "").toLowerCase();
  const ref = (bf.reference_number || "").toLowerCase();

  // 1. Amount (40)
  let partial = false;
  if (Math.abs(bankAmt - inv.balance_due) < 0.01) {
    score += 40; reasons.push(`Amount exact match (${bankAmt})`);
  } else if (Math.abs(bankAmt - inv.total_amount) < 0.01) {
    score += 35; reasons.push(`Amount matches invoice total`);
  } else if (bankAmt < inv.balance_due && bankAmt >= inv.balance_due * 0.1) {
    score += 25; partial = true; reasons.push(`Partial payment (${bankAmt} of ${inv.balance_due})`);
  } else {
    return { score: 0, reasons: [], partial: false };
  }

  // 2. Date window (20)
  const days = Math.abs(new Date(bf.transaction_date).getTime() - new Date(inv.issue_date).getTime()) / 86400000;
  if (days <= 1) { score += 20; reasons.push("Date: within 1 day"); }
  else if (days <= 7) { score += 15; reasons.push(`Date: within ${Math.round(days)}d`); }
  else if (days <= 30) { score += 10; reasons.push(`Date: within ${Math.round(days)}d`); }
  else if (days <= 90) { score += 5; }

  // 3. Customer/invoice ref in description (20)
  const invNumNorm = inv.invoice_number.toLowerCase().replace(/[^a-z0-9]/g, "");
  const descNorm = desc.replace(/[^a-z0-9]/g, "");
  const refNorm = ref.replace(/[^a-z0-9]/g, "");
  if (invNumNorm && (descNorm.includes(invNumNorm) || refNorm.includes(invNumNorm))) {
    score += 20; reasons.push(`Invoice # "${inv.invoice_number}" found in description`);
  } else if (inv.customer_name) {
    const custTokens = inv.customer_name.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
    const hit = custTokens.some((t) => desc.includes(t));
    if (hit) { score += 15; reasons.push(`Customer "${inv.customer_name}" matched in description`); }
  }

  // 4. Description payment intent (10)
  if (PAYMENT_INTENT_KEYWORDS.some((k) => desc.includes(k))) {
    score += 10; reasons.push("Payment intent detected");
  }

  // 5. Status open boost (10)
  if (inv.status === "posted" || inv.status === "sent" || inv.status === "partial") {
    score += 10;
  }

  return { score, reasons, partial };
}

async function arInferenceMatch(
  supabase: any,
  tenantId: string,
  bankAccountId: string,
  bankFeeds: BankFeed[],
  usedBank: Set<string>,
  reconciliationId: string
): Promise<{ matches: MatchResult[]; suggestions: number; auto: number }> {
  const results: MatchResult[] = [];
  let suggestions = 0;
  let auto = 0;

  // Filter to inflows with payment intent
  const candidates = bankFeeds.filter((bf) => !usedBank.has(bf.id) && detectPaymentIntent(bf.description, bf.amount));
  if (candidates.length === 0) return { matches: results, suggestions, auto };

  // Resolve default AR account from settings (fallback)
  const { data: settings } = await supabase
    .from("account_settings")
    .select("ar_account_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const defaultArAccountId = settings?.ar_account_id || null;

  // Fetch open invoices
  const openInvoices = await fetchOpenInvoices(supabase, tenantId);
  if (openInvoices.length === 0) return { matches: results, suggestions, auto };

  // Score each candidate against all invoices
  for (const bf of candidates) {
    let best: { inv: OpenInvoice; score: number; reasons: string[]; partial: boolean } | null = null;

    for (const inv of openInvoices) {
      const { score, reasons, partial } = scoreInvoiceMatch(bf, inv);
      if (score < 60) continue; // floor
      if (!best || score > best.score) best = { inv, score, reasons, partial };
    }

    if (!best) continue;

    const arAccountId = best.inv.ar_account_id || defaultArAccountId;
    if (!arAccountId) {
      // Cannot create payment without AR account; emit suggestion only
      results.push({
        bank_feed_id: bf.id,
        recon_txn_ids: [],
        journal_line_ids: [],
        confidence: best.score,
        method: "ar_inference",
        match_type: "AR_SUGGESTED",
        reasons: [...best.reasons, "⚠ AR account not configured — cannot auto-create payment"],
      });
      await supabase.from("bank_feed_transactions").update({
        status: "suggested",
        match_type: "AR_INFERRED",
        match_confidence: best.score,
        match_metadata: {
          method: "ar_inference",
          confidence: best.score,
          reasons: best.reasons,
          inferred_invoice_id: best.inv.id,
          inferred_invoice_number: best.inv.invoice_number,
          partial: best.partial,
          timestamp: new Date().toISOString(),
        },
      }).eq("id", bf.id);
      usedBank.add(bf.id);
      suggestions++;
      continue;
    }

    // High confidence (>=95) → auto-create payment + JE + recon link + cleared
    if (best.score >= 95) {
      const payAmount = best.partial ? Math.abs(bf.amount) : Math.min(Math.abs(bf.amount), best.inv.balance_due);
      try {
        // 1. Insert payments_received
        const { data: pmt, error: pmtErr } = await supabase
          .from("payments_received")
          .insert({
            invoice_id: best.inv.id,
            amount: payAmount,
            payment_date: bf.transaction_date,
            payment_method: "bank_transfer",
            reference: bf.reference_number || `BANK-${bf.id.slice(0, 8)}`,
            bank_account_id: bankAccountId,
            ar_account_id: arAccountId,
          })
          .select()
          .single();
        if (pmtErr) throw pmtErr;

        // 2. Create JE: Dr Bank / Cr AR
        const { data: je, error: jeErr } = await supabase
          .from("journal_entries")
          .insert({
            tenant_id: tenantId,
            entry_date: bf.transaction_date,
            description: `Auto-matched payment from bank feed for invoice ${best.inv.invoice_number}`,
            reference: bf.reference_number || best.inv.invoice_number,
            source_type: "payment_received",
            source_id: pmt.id,
            status: "posted",
          })
          .select()
          .single();
        if (jeErr) throw jeErr;

        // 3. Insert journal lines
        const { data: jLines, error: jlErr } = await supabase
          .from("journal_lines")
          .insert([
            { journal_entry_id: je.id, account_id: bankAccountId, debit: payAmount, credit: 0 },
            { journal_entry_id: je.id, account_id: arAccountId, debit: 0, credit: payAmount, customer_id: best.inv.customer_id },
          ])
          .select();
        if (jlErr) throw jlErr;

        // 4. AR subledger entry (credit reduces AR)
        await supabase.from("ar_subledger").insert({
          tenant_id: tenantId,
          customer_id: best.inv.customer_id,
          journal_line_id: jLines!.find((l: any) => l.account_id === arAccountId)!.id,
          journal_id: je.id,
          document_type: "payment_received",
          document_id: pmt.id,
          debit: 0,
          credit: payAmount,
          amount: payAmount,
        });

        // 5. Link payment to JE
        await supabase.from("payments_received").update({ journal_entry_id: je.id }).eq("id", pmt.id);

        // 6. Update invoice status (partial vs paid)
        const newStatus = best.partial ? "partial" : "paid";
        await supabase.from("invoices").update({ status: newStatus }).eq("id", best.inv.id);

        // 7. Add the bank-side journal line into reconciliation_transactions as cleared
        const bankLine = jLines!.find((l: any) => l.account_id === bankAccountId)!;
        const { data: newReconTxn } = await supabase
          .from("reconciliation_transactions")
          .insert({
            reconciliation_id: reconciliationId,
            journal_line_id: bankLine.id,
            cleared: true,
            cleared_date: bf.transaction_date,
          })
          .select()
          .single();

        // 8. Mark bank feed matched
        await supabase.from("bank_feed_transactions").update({
          status: "matched",
          matched_journal_line_id: bankLine.id,
          match_type: "AR_INFERRED",
          match_confidence: best.score,
          match_metadata: {
            method: "ar_inference",
            confidence: best.score,
            reasons: best.reasons,
            created_payment_id: pmt.id,
            inferred_invoice_id: best.inv.id,
            inferred_invoice_number: best.inv.invoice_number,
            partial: best.partial,
            payment_amount: payAmount,
            timestamp: new Date().toISOString(),
          },
        }).eq("id", bf.id);

        usedBank.add(bf.id);
        auto++;
        results.push({
          bank_feed_id: bf.id,
          recon_txn_ids: newReconTxn ? [newReconTxn.id] : [],
          journal_line_ids: [bankLine.id],
          confidence: best.score,
          method: "ar_inference",
          match_type: best.partial ? "AR_AUTO_PARTIAL" : "AR_AUTO_FULL",
          reasons: [...best.reasons, `✓ Created payment for invoice ${best.inv.invoice_number} (${payAmount})`],
        });
      } catch (e) {
        console.error("AR auto-post failed for bank feed", bf.id, e);
        // Fallback to suggestion
        await supabase.from("bank_feed_transactions").update({
          status: "suggested",
          match_type: "AR_INFERRED",
          match_confidence: best.score,
          match_metadata: {
            method: "ar_inference",
            confidence: best.score,
            reasons: [...best.reasons, `⚠ Auto-post failed: ${e instanceof Error ? e.message : "unknown"}`],
            inferred_invoice_id: best.inv.id,
            inferred_invoice_number: best.inv.invoice_number,
            partial: best.partial,
            timestamp: new Date().toISOString(),
          },
        }).eq("id", bf.id);
        usedBank.add(bf.id);
        suggestions++;
      }
    } else if (best.score >= 80) {
      // Suggestion only
      await supabase.from("bank_feed_transactions").update({
        status: "suggested",
        match_type: "AR_INFERRED",
        match_confidence: best.score,
        match_metadata: {
          method: "ar_inference",
          confidence: best.score,
          reasons: best.reasons,
          inferred_invoice_id: best.inv.id,
          inferred_invoice_number: best.inv.invoice_number,
          partial: best.partial,
          timestamp: new Date().toISOString(),
        },
      }).eq("id", bf.id);
      usedBank.add(bf.id);
      suggestions++;
      results.push({
        bank_feed_id: bf.id,
        recon_txn_ids: [],
        journal_line_ids: [],
        confidence: best.score,
        method: "ar_inference",
        match_type: "AR_SUGGESTED",
        reasons: [...best.reasons, `Suggested invoice ${best.inv.invoice_number} — review and approve`],
      });
    }
  }

  return { matches: results, suggestions, auto };
}

// ─── Step 6b: AR Allocation Engine (one bank deposit → multiple invoices, FIFO) ───
// Tries to allocate a single inflow across multiple open invoices for the same/inferred customer.
// FIFO by oldest issue_date. Last invoice may receive a partial payment.
async function arAllocationMatch(
  supabase: any,
  tenantId: string,
  bankAccountId: string,
  bankFeeds: BankFeed[],
  usedBank: Set<string>,
  reconciliationId: string
): Promise<{ matches: MatchResult[]; auto: number; suggestions: number }> {
  const results: MatchResult[] = [];
  let auto = 0;
  let suggestions = 0;

  const candidates = bankFeeds.filter((bf) => !usedBank.has(bf.id) && detectPaymentIntent(bf.description, bf.amount));
  if (candidates.length === 0) return { matches: results, auto, suggestions };

  const { data: settings } = await supabase
    .from("account_settings")
    .select("ar_account_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const defaultArAccountId = settings?.ar_account_id || null;

  const openInvoices = await fetchOpenInvoices(supabase, tenantId);
  if (openInvoices.length === 0) return { matches: results, auto, suggestions };

  // Group invoices by customer, sorted FIFO (oldest first)
  const byCustomer = new Map<string, OpenInvoice[]>();
  for (const inv of openInvoices) {
    if (!byCustomer.has(inv.customer_id)) byCustomer.set(inv.customer_id, []);
    byCustomer.get(inv.customer_id)!.push(inv);
  }
  for (const arr of byCustomer.values()) {
    arr.sort((a, b) => new Date(a.issue_date).getTime() - new Date(b.issue_date).getTime());
  }

  for (const bf of candidates) {
    const bankAmt = Math.abs(bf.amount);
    const desc = (bf.description || "").toLowerCase();

    // Identify candidate customer(s) by name token in description
    const customerCandidates: string[] = [];
    for (const [cid, invs] of byCustomer.entries()) {
      const name = invs[0].customer_name || "";
      const tokens = name.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
      if (tokens.length && tokens.some((t) => desc.includes(t))) customerCandidates.push(cid);
    }
    if (customerCandidates.length === 0) continue; // need a customer signal for allocation

    // Try each candidate customer; pick the one whose FIFO sum best fits bankAmt
    let chosen: { cid: string; allocations: { inv: OpenInvoice; amount: number; partial: boolean }[]; totalAllocated: number } | null = null;

    for (const cid of customerCandidates) {
      const invs = byCustomer.get(cid)!;
      let remaining = bankAmt;
      const allocations: { inv: OpenInvoice; amount: number; partial: boolean }[] = [];
      for (const inv of invs) {
        if (remaining < 0.01) break;
        if (remaining + 0.01 >= inv.balance_due) {
          allocations.push({ inv, amount: inv.balance_due, partial: false });
          remaining -= inv.balance_due;
        } else {
          // Partial on the last invoice
          if (remaining >= inv.balance_due * 0.05) {
            allocations.push({ inv, amount: remaining, partial: true });
            remaining = 0;
          }
          break;
        }
      }
      const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
      // Require >= 2 invoices (otherwise 1:1 engine handles it) and near-full consumption
      if (allocations.length >= 2 && Math.abs(totalAllocated - bankAmt) < Math.max(0.01, bankAmt * 0.001)) {
        if (!chosen || totalAllocated > chosen.totalAllocated) {
          chosen = { cid, allocations, totalAllocated };
        }
      }
    }

    if (!chosen) continue;

    const firstInv = chosen.allocations[0].inv;
    const arAccountId = firstInv.ar_account_id || defaultArAccountId;
    const reasonsBase = [
      `One-to-many allocation across ${chosen.allocations.length} invoices`,
      `Customer: ${firstInv.customer_name}`,
      `FIFO: ${chosen.allocations.map((a) => `${a.inv.invoice_number}(${a.amount}${a.partial ? " partial" : ""})`).join(", ")}`,
    ];

    if (!arAccountId) {
      await supabase.from("bank_feed_transactions").update({
        status: "suggested",
        match_type: "AR_ALLOCATION",
        match_confidence: 90,
        match_metadata: {
          method: "ar_allocation",
          confidence: 90,
          reasons: [...reasonsBase, "⚠ AR account not configured — cannot auto-create payments"],
          allocations: chosen.allocations.map((a) => ({ invoice_id: a.inv.id, invoice_number: a.inv.invoice_number, amount: a.amount, partial: a.partial })),
          timestamp: new Date().toISOString(),
        },
      }).eq("id", bf.id);
      usedBank.add(bf.id);
      suggestions++;
      results.push({ bank_feed_id: bf.id, recon_txn_ids: [], journal_line_ids: [], confidence: 90, method: "ar_allocation", match_type: "AR_SUGGESTED", reasons: reasonsBase });
      continue;
    }

    // Auto-post: one JE with one Bank Dr line + N AR Cr lines, plus N payments_received rows
    try {
      const totalAmt = chosen.totalAllocated;
      const { data: je, error: jeErr } = await supabase
        .from("journal_entries")
        .insert({
          tenant_id: tenantId,
          entry_date: bf.transaction_date,
          description: `Bank deposit allocated to ${chosen.allocations.length} invoices for ${firstInv.customer_name}`,
          reference: bf.reference_number || `ALLOC-${bf.id.slice(0, 8)}`,
          source_type: "bank_allocation",
          source_id: bf.id,
          status: "posted",
        })
        .select()
        .single();
      if (jeErr) throw jeErr;

      const linePayload: any[] = [
        { journal_entry_id: je.id, account_id: bankAccountId, debit: totalAmt, credit: 0 },
      ];
      for (const a of chosen.allocations) {
        linePayload.push({
          journal_entry_id: je.id,
          account_id: a.inv.ar_account_id || arAccountId,
          debit: 0,
          credit: a.amount,
          customer_id: a.inv.customer_id,
        });
      }
      const { data: jLines, error: jlErr } = await supabase.from("journal_lines").insert(linePayload).select();
      if (jlErr) throw jlErr;

      const bankLine = jLines!.find((l: any) => l.account_id === bankAccountId && Number(l.debit) > 0);

      // Per-invoice: payment row + AR subledger + status update
      for (const a of chosen.allocations) {
        const arLine = jLines!.find(
          (l: any) =>
            l.account_id === (a.inv.ar_account_id || arAccountId) &&
            Number(l.credit) === a.amount &&
            l.customer_id === a.inv.customer_id
        );

        const { data: pmt } = await supabase
          .from("payments_received")
          .insert({
            invoice_id: a.inv.id,
            amount: a.amount,
            payment_date: bf.transaction_date,
            payment_method: "bank_transfer",
            reference: bf.reference_number || `ALLOC-${a.inv.invoice_number}`,
            bank_account_id: bankAccountId,
            ar_account_id: a.inv.ar_account_id || arAccountId,
            journal_entry_id: je.id,
          })
          .select()
          .single();

        if (arLine) {
          await supabase.from("ar_subledger").insert({
            tenant_id: tenantId,
            customer_id: a.inv.customer_id,
            journal_line_id: arLine.id,
            journal_id: je.id,
            document_type: "payment_received",
            document_id: pmt?.id,
            debit: 0,
            credit: a.amount,
            amount: a.amount,
          });
        }

        await supabase.from("invoices").update({ status: a.partial ? "partial" : "paid" }).eq("id", a.inv.id);
      }

      // Add bank line as cleared recon transaction
      const { data: newReconTxn } = await supabase
        .from("reconciliation_transactions")
        .insert({
          reconciliation_id: reconciliationId,
          journal_line_id: bankLine!.id,
          cleared: true,
          cleared_date: bf.transaction_date,
        })
        .select()
        .single();

      await supabase.from("bank_feed_transactions").update({
        status: "matched",
        matched_journal_line_id: bankLine!.id,
        match_type: "AR_ALLOCATION",
        match_confidence: 96,
        match_metadata: {
          method: "ar_allocation",
          confidence: 96,
          reasons: reasonsBase,
          allocations: chosen.allocations.map((a) => ({ invoice_id: a.inv.id, invoice_number: a.inv.invoice_number, amount: a.amount, partial: a.partial })),
          journal_entry_id: je.id,
          timestamp: new Date().toISOString(),
        },
      }).eq("id", bf.id);

      usedBank.add(bf.id);
      auto++;
      results.push({
        bank_feed_id: bf.id,
        recon_txn_ids: newReconTxn ? [newReconTxn.id] : [],
        journal_line_ids: [bankLine!.id],
        confidence: 96,
        method: "ar_allocation",
        match_type: "AR_AUTO_ALLOCATED",
        reasons: [...reasonsBase, `✓ Allocated ${totalAmt} across ${chosen.allocations.length} invoices`],
      });
    } catch (e) {
      console.error("AR allocation auto-post failed", bf.id, e);
      await supabase.from("bank_feed_transactions").update({
        status: "suggested",
        match_type: "AR_ALLOCATION",
        match_confidence: 85,
        match_metadata: {
          method: "ar_allocation",
          confidence: 85,
          reasons: [...reasonsBase, `⚠ Auto-post failed: ${e instanceof Error ? e.message : "unknown"}`],
          allocations: chosen.allocations.map((a) => ({ invoice_id: a.inv.id, invoice_number: a.inv.invoice_number, amount: a.amount, partial: a.partial })),
          timestamp: new Date().toISOString(),
        },
      }).eq("id", bf.id);
      usedBank.add(bf.id);
      suggestions++;
    }
  }

  return { matches: results, auto, suggestions };
}

// ─── Step 7: Standard Scoring Engine (Fallback) ───
function scoringMatch(
  bankFeeds: BankFeed[],
  ledgerEntries: LedgerEntry[],
  usedBank: Set<string>,
  usedLedger: Set<string>
): MatchResult[] {
  const results: MatchResult[] = [];
  const allScores: Array<{
    bank_feed_id: string;
    recon_txn_id: string;
    journal_line_id: string;
    score: number;
    reasons: string[];
  }> = [];

  for (const bf of bankFeeds) {
    if (usedBank.has(bf.id)) continue;
    const bankAmt = Math.abs(bf.amount);

    for (const le of ledgerEntries) {
      if (usedLedger.has(le.recon_txn_id)) continue;
      const ledgerAmt = Math.abs(le.net_amount);

      // Pre-filter: amount must be within 20
      if (Math.abs(bankAmt - ledgerAmt) >= 20) continue;

      let score = 0;
      const reasons: string[] = [];

      // Amount (40%)
      if (Math.abs(bankAmt - ledgerAmt) < 0.01) {
        score += 0.4;
        reasons.push("Amount: exact match");
      } else if (Math.abs(bankAmt - ledgerAmt) / Math.max(bankAmt, 1) < 0.01) {
        score += 0.3;
        reasons.push("Amount: within 1%");
      } else {
        continue;
      }

      // Date (25%)
      const daysDiff = Math.abs(new Date(bf.transaction_date).getTime() - new Date(le.entry_date).getTime()) / 86400000;
      if (daysDiff === 0) { score += 0.25; reasons.push("Date: same day"); }
      else if (daysDiff <= 1) { score += 0.2; reasons.push("Date: ±1 day"); }
      else if (daysDiff <= 3) { score += 0.15; reasons.push("Date: ±3 days"); }
      else if (daysDiff <= 7) { score += 0.05; reasons.push(`Date: ${daysDiff}d apart`); }

      // Description (20%)
      const descSim = similarity(bf.description || "", le.description || "");
      score += descSim * 0.2;
      if (descSim > 0.3) reasons.push(`Description: ${Math.round(descSim * 100)}% similar`);

      // Reference (15%)
      if (bf.reference_number && le.reference) {
        const refSim = similarity(bf.reference_number, le.reference);
        score += refSim * 0.15;
        if (refSim > 0.3) reasons.push(`Reference: ${Math.round(refSim * 100)}% similar`);
      }

      // Source type boost
      if (le.source_type) {
        score += 0.03;
        reasons.push(`Source: ${le.source_type}`);
      }

      if (score >= 0.4) {
        allScores.push({
          bank_feed_id: bf.id,
          recon_txn_id: le.recon_txn_id,
          journal_line_id: le.journal_line_id,
          score,
          reasons,
        });
      }
    }
  }

  // Greedy best-match
  allScores.sort((a, b) => b.score - a.score);
  for (const s of allScores) {
    if (usedBank.has(s.bank_feed_id) || usedLedger.has(s.recon_txn_id)) continue;
    const confidence = Math.round(s.score * 100);
    const isAuto = confidence >= 90;

    results.push({
      bank_feed_id: s.bank_feed_id,
      recon_txn_ids: [s.recon_txn_id],
      journal_line_ids: [s.journal_line_id],
      confidence,
      method: "scoring",
      match_type: isAuto ? "AUTO_MATCHED" : "SUGGESTED",
      reasons: s.reasons,
    });
    usedBank.add(s.bank_feed_id);
    usedLedger.add(s.recon_txn_id);
  }
  return results;
}

// ─── Main Handler ───
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { reconciliation_id, bank_account_id } = await req.json();
    if (!reconciliation_id || !bank_account_id) {
      return new Response(JSON.stringify({ error: "Missing reconciliation_id or bank_account_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Fetch reconciliation for tenant context ───
    const { data: recon, error: reconErr } = await supabase
      .from("bank_reconciliations")
      .select("tenant_id, statement_ending_date, status")
      .eq("id", reconciliation_id)
      .single();
    if (reconErr) throw reconErr;
    if (recon.status === "reconciled") {
      return new Response(JSON.stringify({ error: "Reconciliation is already completed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── STEP 1: Period Lock Check ───
    const lockError = await checkPeriodLock(supabase, recon.tenant_id, recon.statement_ending_date);
    if (lockError) {
      return new Response(JSON.stringify({ error: lockError }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Fetch bank feed transactions ───
    const { data: bankFeeds, error: bfErr } = await supabase
      .from("bank_feed_transactions")
      .select("id, transaction_date, description, amount, reference_number")
      .eq("reconciliation_id", reconciliation_id)
      .eq("status", "unmatched")
      .eq("is_duplicate", false);
    if (bfErr) throw bfErr;

    // ─── Fetch ledger entries with source info ───
    const { data: reconTxns, error: rtErr } = await supabase
      .from("reconciliation_transactions")
      .select("id, journal_line_id, cleared, journal_lines(id, debit, credit, journal_entries(entry_date, description, reference, source_type, source_id))")
      .eq("reconciliation_id", reconciliation_id)
      .eq("cleared", false);
    if (rtErr) throw rtErr;

    const ledgerEntries: LedgerEntry[] = (reconTxns || []).map((rt: any) => {
      const jl = rt.journal_lines;
      const je = jl?.journal_entries;
      const debit = Number(jl?.debit) || 0;
      const credit = Number(jl?.credit) || 0;
      return {
        recon_txn_id: rt.id,
        journal_line_id: rt.journal_line_id,
        entry_date: je?.entry_date || "",
        description: je?.description || "",
        reference: je?.reference || null,
        source_type: je?.source_type || null,
        source_id: je?.source_id || null,
        debit,
        credit,
        net_amount: debit - credit,
      };
    });

    const usedBank = new Set<string>();
    const usedLedger = new Set<string>();
    const allMatches: MatchResult[] = [];

    // ─── STEP 2: Rule Engine FIRST ───
    const { applied: rulesApplied, posted: rulesPosted } = await applyRules(
      supabase,
      { id: reconciliation_id, tenant_id: recon.tenant_id, bank_account_id },
      bankFeeds || [],
      usedBank
    );

    // ─── STEP 3: Source-Based Matching ───
    const sourceMatches = sourceMatch(bankFeeds || [], ledgerEntries, usedBank, usedLedger);
    allMatches.push(...sourceMatches);

    // ─── STEP 4: Module Resolver ───
    const moduleMatches = moduleResolve(bankFeeds || [], ledgerEntries, usedBank, usedLedger);
    allMatches.push(...moduleMatches);

    // ─── STEP 5: Combination Matching ───
    const comboMatches = comboMatch(bankFeeds || [], ledgerEntries, usedBank, usedLedger);
    allMatches.push(...comboMatches);

    // ─── STEP 6: AR Inference (QuickBooks-style payment intent → invoice) ───
    const arResult = await arInferenceMatch(
      supabase,
      recon.tenant_id,
      bank_account_id,
      bankFeeds || [],
      usedBank,
      reconciliation_id
    );
    allMatches.push(...arResult.matches);

    // ─── STEP 6b: AR Allocation (one bank deposit → many invoices, FIFO) ───
    const allocResult = await arAllocationMatch(
      supabase,
      recon.tenant_id,
      bank_account_id,
      bankFeeds || [],
      usedBank,
      reconciliation_id
    );
    allMatches.push(...allocResult.matches);

    // ─── STEP 7: Standard Scoring (final fallback) ───
    const scoringMatches = scoringMatch(bankFeeds || [], ledgerEntries, usedBank, usedLedger);
    allMatches.push(...scoringMatches);

    // ─── Persist all matches (skip ar_inference & ar_allocation — already persisted) ───
    let autoMatched = arResult.auto + allocResult.auto;
    let suggested = arResult.suggestions + allocResult.suggestions;

    for (const m of allMatches) {
      if (m.method === "ar_inference" || m.method === "ar_allocation") continue; // already persisted
      const isAuto = m.match_type === "AUTO_MATCHED" || m.match_type === "GROUP_MATCHED";
      const metadata = {
        method: m.method,
        confidence: m.confidence,
        reasons: m.reasons,
        timestamp: new Date().toISOString(),
        matched_entries: m.journal_line_ids,
      };

      await supabase
        .from("bank_feed_transactions")
        .update({
          status: isAuto ? "matched" : "suggested",
          matched_journal_line_id: m.journal_line_ids[0],
          match_confidence: m.confidence,
          match_type: m.match_type,
          match_metadata: metadata,
        })
        .eq("id", m.bank_feed_id);

      if (isAuto) {
        for (const rtId of m.recon_txn_ids) {
          await supabase
            .from("reconciliation_transactions")
            .update({ cleared: true, cleared_date: new Date().toISOString().split("T")[0] })
            .eq("id", rtId);
        }
        autoMatched++;
      } else {
        suggested++;
      }
    }

    // ─── Update reconciliation cleared balance ───
    const { data: clearedTxns } = await supabase
      .from("reconciliation_transactions")
      .select("journal_lines(debit, credit)")
      .eq("reconciliation_id", reconciliation_id)
      .eq("cleared", true);

    let clearedBalance = 0;
    if (clearedTxns) {
      for (const ct of clearedTxns) {
        const d = Number((ct as any).journal_lines?.debit) || 0;
        const c = Number((ct as any).journal_lines?.credit) || 0;
        clearedBalance += d - c;
      }
    }

    return new Response(JSON.stringify({
      matches: allMatches.length,
      auto_matched: autoMatched,
      suggested,
      rules_applied: rulesApplied,
      rules_posted: rulesPosted,
      breakdown: {
        source: sourceMatches.length,
        module: moduleMatches.length,
        combo: comboMatches.length,
        ar_inference: arResult.matches.length,
        ar_auto_posted: arResult.auto,
        ar_allocation: allocResult.matches.length,
        ar_allocation_auto: allocResult.auto,
        scoring: scoringMatches.length,
      },
      match_details: allMatches.map(m => ({
        bank_feed_id: m.bank_feed_id,
        confidence: m.confidence,
        method: m.method,
        match_type: m.match_type,
        reasons: m.reasons,
      })),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("match-transactions error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
