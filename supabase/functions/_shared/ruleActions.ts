// ═══════════════════════════════════════════════════════════════════════════
// SHARED reconciliation-rule action engine — SINGLE SOURCE OF TRUTH.
//
// Imported by BOTH bank-feed matching paths so they can never diverge:
//   • match-transactions/index.ts  ("AI Match" — the primary button users click)
//   • reconcile-engine/index.ts    ("Engine Match")
//
// `ruleConditionMatches` decides whether a rule's condition fires on a bank line.
// `executeRuleAction` is the ONLY place that auto-creates a journal entry for a
// rule-only match (no ledger counterpart). It enforces the sign guard, tax-
// inclusive split, double-entry balance, closed-period lock, and idempotency
// (source_type='reconciliation_rule', source_id=<bank_feed_transactions.id>).
// ═══════════════════════════════════════════════════════════════════════════

const EPS = 0.01;

export interface RuleLike {
  id: string;
  name: string;
  condition_field: string;
  condition_operator: string;
  condition_value: string | null;
  condition_amount_min: number | null;
  condition_amount_max: number | null;
  action_create_expense: boolean | null;
  action_account_id: string | null;
  action_direction: string | null; // 'outflow' | 'inflow' | 'either'
  tax_account_id: string | null;
  tax_rate: number | null;
  counterparty_name: string | null;
}

export interface BankLineLike {
  id: string;
  amount: number;
  description: string | null;
  transaction_date: string;
  reference_number?: string | null;
  state?: string;
}

export interface ReconLike {
  id: string; // reconciliation_id — links the cleared bank-side line
  tenant_id: string;
  bank_account_id: string;
}

export type RuleActionOutcome =
  | {
      kind: "posted";
      je_id: string;
      bank_line_id: string;
      net: number;
      tax: number;
      direction: "inflow" | "outflow";
      reused: boolean;
    }
  | { kind: "suggested"; reason: string };

// ─── Pure condition matcher (shared so both engines evaluate rules identically) ──
export function ruleConditionMatches(rule: RuleLike, b: BankLineLike): boolean {
  const desc = (b.description || "").toLowerCase();
  const val = (rule.condition_value || "").toLowerCase();
  const amt = Math.abs(Number(b.amount) || 0);

  if (rule.condition_field === "description") {
    if (rule.condition_operator === "contains" && val && desc.includes(val)) return true;
    if (rule.condition_operator === "equals" && desc === val) return true;
    if (rule.condition_operator === "starts_with" && val && desc.startsWith(val)) return true;
  }
  if (rule.condition_field === "amount") {
    if (
      rule.condition_operator === "range" &&
      rule.condition_amount_min != null &&
      rule.condition_amount_max != null
    ) {
      return amt >= Number(rule.condition_amount_min) && amt <= Number(rule.condition_amount_max);
    }
    if (rule.condition_operator === "equals" && val) return Math.abs(amt - parseFloat(val)) < EPS;
    if (rule.condition_operator === "gt" && val) return amt > parseFloat(val);
    if (rule.condition_operator === "lt" && val) return amt < parseFloat(val);
  }
  if (rule.condition_field === "reference") {
    const ref = (b.reference_number || "").toLowerCase();
    if (rule.condition_operator === "contains" && val && ref.includes(val)) return true;
    if (rule.condition_operator === "equals" && ref === val) return true;
  }
  return false;
}

// True when action_create_expense is the master switch AND an account is configured.
export function ruleWillPost(rule: RuleLike): boolean {
  return rule.action_create_expense === true && !!rule.action_account_id;
}

// Closed-period guard — mirrors match-transactions/checkPeriodLock.
// Returns a human reason if the date falls inside a closed fiscal period, else null.
export async function isPeriodLocked(
  supabase: any,
  tenantId: string,
  date: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("fiscal_periods")
    .select("name, status")
    .eq("tenant_id", tenantId)
    .eq("status", "closed")
    .lte("period_start", date)
    .gte("period_end", date)
    .limit(1);
  if (data && data.length > 0) return `Period "${data[0].name}" is closed`;
  return null;
}

// ─── The single rule-action executor ────────────────────────────────────────
// GATE → SIGN GUARD → TAX SPLIT → BALANCE → PERIOD LOCK → IDEMPOTENT INSERT →
// CLEAR + STAMP.  Returns {kind:"posted"} on success or {kind:"suggested"} with a
// reason when the rule should fall through to suggest-only behaviour.
export async function executeRuleAction(
  supabase: any,
  recon: ReconLike,
  bankLine: BankLineLike,
  rule: RuleLike,
): Promise<RuleActionOutcome> {
  // GATE: only post when the master switch is on and an account is configured.
  if (rule.action_create_expense !== true) return { kind: "suggested", reason: "action_create_expense is off" };
  if (!rule.action_account_id) return { kind: "suggested", reason: "no action_account_id" };

  // SIGN GUARD
  const amt = Math.abs(Number(bankLine.amount));
  const isInflow = Number(bankLine.amount) >= 0;
  const dir = rule.action_direction || "outflow";
  if (dir === "outflow" && isInflow) {
    return { kind: "suggested", reason: "rule direction is outflow but bank line is an inflow" };
  }
  if (dir === "inflow" && !isInflow) {
    return { kind: "suggested", reason: "rule direction is inflow but bank line is an outflow" };
  }
  // After the guards, 'either' resolves by the bank line's sign.
  const direction: "inflow" | "outflow" =
    dir === "inflow" ? "inflow" : dir === "outflow" ? "outflow" : isInflow ? "inflow" : "outflow";

  // TAX SPLIT (amount is tax-inclusive)
  const rate = Number(rule.tax_rate) || 0;
  if (rate > 0 && !rule.tax_account_id) {
    return { kind: "suggested", reason: "tax_rate set but no tax_account_id" };
  }
  const net = rate > 0 ? +(amt / (1 + rate)).toFixed(2) : amt;
  const tax = +(amt - net).toFixed(2);

  // LINES (debit/credit) — see column-semantics comment in the migration.
  const lineDefs =
    direction === "outflow"
      ? [
          { account_id: rule.action_account_id, debit: net, credit: 0 },
          ...(rate > 0 ? [{ account_id: rule.tax_account_id, debit: tax, credit: 0 }] : []),
          { account_id: recon.bank_account_id, debit: 0, credit: amt },
        ]
      : [
          { account_id: recon.bank_account_id, debit: amt, credit: 0 },
          { account_id: rule.action_account_id, debit: 0, credit: net },
          ...(rate > 0 ? [{ account_id: rule.tax_account_id, debit: 0, credit: tax }] : []),
        ];

  const totalDebit = +lineDefs.reduce((s, l) => s + l.debit, 0).toFixed(2);
  const totalCredit = +lineDefs.reduce((s, l) => s + l.credit, 0).toFixed(2);
  if (Math.abs(totalDebit - totalCredit) > EPS) {
    throw new Error(`Rule JE does not balance: Dr ${totalDebit} vs Cr ${totalCredit}`);
  }

  // PERIOD LOCK
  const lockReason = await isPeriodLocked(supabase, recon.tenant_id, bankLine.transaction_date);
  if (lockReason) return { kind: "suggested", reason: lockReason };

  const description = `${rule.counterparty_name ? rule.counterparty_name + " — " : ""}${rule.name}: ${
    bankLine.description || ""
  }`.slice(0, 255);

  // IDEMPOTENCY — reuse an existing rule JE for this bank line if one exists.
  let je: any = null;
  let reused = false;
  const { data: existing } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("source_type", "reconciliation_rule")
    .eq("source_id", bankLine.id)
    .neq("status", "voided")
    .limit(1)
    .maybeSingle();

  if (existing) {
    je = existing;
    reused = true;
  } else {
    const { data: inserted, error: jeErr } = await supabase
      .from("journal_entries")
      .insert({
        tenant_id: recon.tenant_id,
        entry_date: bankLine.transaction_date,
        description,
        reference: `RULE-${rule.id.slice(0, 8)}`,
        status: "posted",
        source_type: "reconciliation_rule",
        source_id: bankLine.id, // CRITICAL: drives idx_je_unique_rule_source
      })
      .select("id")
      .single();

    if (jeErr) {
      // Unique violation → another run already posted it; reuse instead of duplicating.
      if ((jeErr as any).code === "23505") {
        const { data: dup } = await supabase
          .from("journal_entries")
          .select("id")
          .eq("source_type", "reconciliation_rule")
          .eq("source_id", bankLine.id)
          .neq("status", "voided")
          .limit(1)
          .maybeSingle();
        if (!dup) throw jeErr;
        je = dup;
        reused = true;
      } else {
        throw jeErr;
      }
    } else {
      je = inserted;
    }
  }

  // Resolve the bank-side journal line (insert lines only when we created the JE).
  let bankLineId: string | null = null;
  if (reused) {
    const { data: existingLines } = await supabase
      .from("journal_lines")
      .select("id, account_id")
      .eq("journal_entry_id", je.id);
    bankLineId = (existingLines || []).find((l: any) => l.account_id === recon.bank_account_id)?.id || null;
  } else {
    const { data: insertedLines, error: jlErr } = await supabase
      .from("journal_lines")
      .insert(lineDefs.map((l) => ({ journal_entry_id: je.id, ...l })))
      .select("id, account_id");
    if (jlErr) throw jlErr;
    bankLineId = (insertedLines || []).find((l: any) => l.account_id === recon.bank_account_id)?.id || null;
  }

  // CLEAR + STAMP
  if (bankLineId) {
    await supabase.from("reconciliation_transactions").upsert(
      {
        reconciliation_id: recon.id,
        journal_line_id: bankLineId,
        cleared: true,
        cleared_date: bankLine.transaction_date,
      },
      { onConflict: "reconciliation_id,journal_line_id" },
    );
  }

  await supabase
    .from("bank_feed_transactions")
    .update({
      state: "matched",
      status: "matched",
      matched_journal_line_id: bankLineId,
      match_type: "RULE_AUTO",
      match_confidence: 92,
      match_metadata: {
        tier: "RULE_AUTO",
        tier_reason: `Rule "${rule.name}" auto-posted a ${direction} JE`,
        rule_id: rule.id,
        rule_name: rule.name,
        je_id: je.id,
        net,
        tax,
        direction,
        reused,
      },
    })
    .eq("id", bankLine.id);

  return { kind: "posted", je_id: je.id, bank_line_id: bankLineId || "", net, tax, direction, reused };
}
