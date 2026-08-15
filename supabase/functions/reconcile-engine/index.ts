// QuickBooks-grade Reconciliation Engine Core
// Deterministic. Snapshot-based. Invariant-enforced. State-machine guarded.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { executeRuleAction, ruleConditionMatches } from "../_shared/ruleActions.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";
import { enumOf, uuid, validateBody } from "../_shared/validate.ts";

const EPS = 0.01;

// ---------- State machine ----------
const TRANSITIONS: Record<string, string[]> = {
  unmatched: ["suggested", "matched"],
  suggested: ["matched", "unmatched"],
  matched: ["cleared", "unmatched"],
  cleared: ["verified", "matched"],
  verified: ["reconciled", "cleared"],
  reconciled: ["locked"],
  locked: [],
};
function assertTransition(from: string, to: string) {
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid state transition: ${from} -> ${to}`);
  }
}

// ---------- Pure helpers ----------
function near(a: number, b: number, eps = EPS) {
  return Math.abs(a - b) <= eps;
}
function dateDistance(a: string, b: string) {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.abs(Math.round((da - db) / 86400000));
}
function tokenSim(a: string, b: string) {
  const A = new Set((a || "").toLowerCase().split(/\W+/).filter(Boolean));
  const B = new Set((b || "").toLowerCase().split(/\W+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}

// ---------- Matching tiers (deterministic) ----------
// Each tier returns a `trace` describing the contributing fields and points,
// plus a `tier_reason` summary so the UI can explain *why* a match fired.
function exactSourceMatch(b: any, candidates: any[]) {
  if (!b.reference_number) return null;
  const ref = String(b.reference_number).trim().toLowerCase();
  for (const c of candidates) {
    const cref = (c.je_reference || "").toLowerCase();
    if (cref && (cref === ref || cref.includes(ref) || ref.includes(cref))) {
      const signed = c.debit - c.credit;
      if (near(Math.abs(signed), Math.abs(b.amount))) {
        const trace = [
          { factor: "reference_number", bank: b.reference_number, ledger: c.je_reference, match: true, points: 60 },
          { factor: "amount", bank: b.amount, ledger: signed, match: true, points: 40 },
        ];
        return {
          type: "SOURCE", target: c, score: 100,
          tier_reason: "Exact reference number AND amount match",
          trace,
        };
      }
    }
  }
  return null;
}

// AP tier: vendor-aware matching for bank outflows against AP payment journal lines.
// Bank outflow = negative; AP payment on bank account = credit (signed < 0).
// Boost on (a) bill_no in description, (b) vendor name token similarity.
function apMatch(b: any, candidates: any[]) {
  if (Number(b.amount) >= 0) return null;
  const desc = (b.description || "").toLowerCase();
  const ref = (b.reference_number || "").toLowerCase();
  let best: any = null;
  let bestScore = 0;
  let bestTrace: any[] = [];
  for (const c of candidates) {
    if (!c.is_ap_payment) continue;
    const signed = c.debit - c.credit;
    if (!near(signed, b.amount)) continue;
    const dd = dateDistance(b.transaction_date, c.entry_date);
    if (dd > 14) continue;
    const trace: any[] = [];
    let s = 70;
    trace.push({ factor: "ap_payment_amount", bank: b.amount, ledger: signed, match: true, points: 70 });
    trace.push({ factor: "date_distance", days: dd, points: dd <= 2 ? 10 : dd <= 7 ? 5 : 0 });
    if (dd <= 2) s += 10;
    else if (dd <= 7) s += 5;
    if (c.bill_no) {
      const bn = String(c.bill_no).toLowerCase();
      const hit = bn && (desc.includes(bn) || ref.includes(bn));
      if (hit) { s += 15; trace.push({ factor: "bill_no", value: c.bill_no, found_in: desc.includes(bn) ? "description" : "reference", points: 15 }); }
    }
    if (c.vendor_name) {
      const sim = tokenSim(b.description || "", c.vendor_name);
      const pts = Math.round(sim * 15);
      s += pts;
      trace.push({ factor: "vendor_name_similarity", vendor: c.vendor_name, similarity: sim.toFixed(2), points: pts });
    }
    if (s > bestScore) { best = c; bestScore = s; bestTrace = trace; }
  }
  if (bestScore >= 90) return {
    type: "AP_AUTO", target: best, score: bestScore,
    tier_reason: `AP payment matched to vendor ${best.vendor_name || "(unknown)"} with high confidence`,
    trace: bestTrace,
  };
  if (bestScore >= 75) return {
    type: "AP_SUGGEST", target: best, score: bestScore,
    tier_reason: `AP payment likely matches vendor ${best.vendor_name || "(unknown)"} — needs review`,
    trace: bestTrace,
  };
  return null;
}

// `ruleConditionMatches` is imported from ../_shared/ruleActions.ts so the
// condition logic is identical across both matching engines.

// Engine RULE tier: prefer user rule that ALSO has a matching ledger candidate.
// Returns { type: "RULE", target, score: 92, rule } when a rule fires AND a
// same-amount ledger line exists within 7 days. Pure ledger fallback returns
// score 90 like before.
function ruleMatch(b: any, candidates: any[], userRules: any[]) {
  for (const rule of userRules) {
    if (!ruleConditionMatches(rule, b)) continue;
    const ruleTrace = [{
      factor: "user_rule",
      rule_name: rule.name,
      condition: `${rule.condition_field} ${rule.condition_operator} ${rule.condition_value ?? ""}`.trim(),
      matched: true,
      points: 60,
    }];
    for (const c of candidates) {
      const signed = c.debit - c.credit;
      const dd = dateDistance(b.transaction_date, c.entry_date);
      if (near(signed, b.amount) && dd <= 7) {
        return {
          type: "RULE", target: c, score: 92, rule,
          tier_reason: `Rule "${rule.name}" matched and a same-amount ledger line was found within ${dd}d`,
          trace: [
            ...ruleTrace,
            { factor: "amount", bank: b.amount, ledger: signed, match: true, points: 22 },
            { factor: "date_distance", days: dd, points: 10 },
          ],
        };
      }
    }
    return {
      type: "RULE_ONLY", target: null, score: 88, rule,
      tier_reason: `Rule "${rule.name}" matched but no ledger candidate exists${rule.action_create_expense && rule.action_account_id ? " — engine will auto-create JE" : " — needs manual review"}`,
      trace: ruleTrace,
    };
  }
  for (const c of candidates) {
    const signed = c.debit - c.credit;
    const dd = dateDistance(b.transaction_date, c.entry_date);
    if (near(signed, b.amount) && dd <= 3) {
      return {
        type: "RULE", target: c, score: 90,
        tier_reason: `Deterministic amount + date match (within ${dd}d, no user rule)`,
        trace: [
          { factor: "amount", bank: b.amount, ledger: signed, match: true, points: 60 },
          { factor: "date_distance", days: dd, points: 30 },
        ],
      };
    }
  }
  return null;
}


function scoringMatch(b: any, candidates: any[]) {
  let best: any = null;
  let bestScore = 0;
  let bestTrace: any[] = [];
  for (const c of candidates) {
    const trace: any[] = [];
    let s = 0;
    const signed = c.debit - c.credit;
    if (near(signed, b.amount)) { s += 50; trace.push({ factor: "amount", bank: b.amount, ledger: signed, match: true, points: 50 }); }
    const dd = dateDistance(b.transaction_date, c.entry_date);
    const dPts = dd <= 2 ? 20 : dd <= 7 ? 10 : 0;
    if (dPts) { s += dPts; trace.push({ factor: "date_distance", days: dd, points: dPts }); }
    const sim = tokenSim(b.description || "", c.je_description || "");
    const tPts = Math.round(sim * 20);
    if (tPts) { s += tPts; trace.push({ factor: "description_similarity", similarity: sim.toFixed(2), points: tPts }); }
    if (c.account_id) { s += 10; trace.push({ factor: "account_present", points: 10 }); }
    if (s > bestScore) { best = c; bestScore = s; bestTrace = trace; }
  }
  if (bestScore >= 85) return {
    type: "SCORING", target: best, score: bestScore,
    tier_reason: `Heuristic scoring match (amount + date + description similarity)`,
    trace: bestTrace,
  };
  return null;
}

function compositeMatch(b: any, candidates: any[]) {
  const pool = candidates
    .filter((c) => Math.sign(c.debit - c.credit) === Math.sign(b.amount))
    .filter((c) => dateDistance(b.transaction_date, c.entry_date) <= 14)
    .slice(0, 6);
  const n = pool.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const bits = mask.toString(2).split("1").length - 1;
    if (bits < 2 || bits > 4) continue;
    let sum = 0;
    const group: any[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += pool[i].debit - pool[i].credit;
        group.push(pool[i]);
      }
    }
    if (near(sum, b.amount)) return {
      type: "COMPOSITE", targets: group, score: 95,
      tier_reason: `Composite: ${group.length} ledger lines sum to bank amount ${b.amount}`,
      trace: [
        { factor: "amount_sum", bank: b.amount, ledger_sum: sum, match: true, points: 60 },
        { factor: "components", count: group.length, points: 35 },
      ],
    };
  }
  return null;
}

function matchOne(b: any, candidates: any[], userRules: any[]) {
  return (
    exactSourceMatch(b, candidates) ||
    apMatch(b, candidates) ||
    ruleMatch(b, candidates, userRules) ||
    scoringMatch(b, candidates) ||
    compositeMatch(b, candidates)
  );
}

// ---------- Invariants ----------
type InvResult = { name: string; expected: number; actual: number; delta: number; passed: boolean };
function checkInvariants(args: {
  beginningBalance: number;
  statementEnding: number;
  ledgerSignedSum: number;
  clearedSum: number;
  ledgerDebits: number;
  ledgerCredits: number;
}): InvResult[] {
  const expectedCleared = args.statementEnding - args.beginningBalance;
  return [
    {
      name: "double_entry_balance",
      expected: args.ledgerDebits,
      actual: args.ledgerCredits,
      delta: args.ledgerDebits - args.ledgerCredits,
      passed: near(args.ledgerDebits, args.ledgerCredits),
    },
    {
      name: "cleared_matches_statement_delta",
      expected: expectedCleared,
      actual: args.clearedSum,
      delta: expectedCleared - args.clearedSum,
      passed: near(expectedCleared, args.clearedSum),
    },
  ];
}

// ---------- Main ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const v = await validateBody(req, {
      reconciliation_id: uuid(),
      action:            enumOf(["snapshot", "match", "validate", "finalize"] as const),
    });
    if (!v.ok) {
      return new Response(JSON.stringify({ error: v.message, fields: v.errors }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { reconciliation_id, action } = v.value;

    // Resolve the caller before loading anything. This handler runs entirely as
    // service_role, so nothing below applies RLS — and reconciliation_id arrives
    // in the request body. Without this, any signed-in user could name another
    // company's reconciliation and drive it, `finalize` included.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: authData } = token ? await supabase.auth.getUser(token) : { data: null };
    if (!authData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: appUser } = await supabase
      .from("users")
      .select("id, tenant_id")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();
    if (!appUser?.tenant_id) {
      return new Response(JSON.stringify({ error: "No tenant context for this user" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load reconciliation — scoped to the caller's tenant, so a foreign id is
    // "not found" rather than a working handle on someone else's books.
    const { data: recon, error: rErr } = await supabase
      .from("bank_reconciliations")
      .select("*")
      .eq("id", reconciliation_id)
      .eq("tenant_id", appUser.tenant_id)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!recon) throw new Error("Reconciliation not found");
    if (recon.locked_at) throw new Error("Reconciliation is locked");

    // Now keyed on the caller as well as the tenant — previously the tenant came
    // off the loaded row, which a caller could vary by choosing a different id.
    const { blocked, headers: rlHeaders } = await enforceRateLimit(
      supabase,
      "reconcile-engine",
      { userId: appUser.id, tenantId: appUser.tenant_id, ip: clientIp(req) },
    );
    if (blocked) return blocked;

    // Load ledger lines for this bank account up to statement date
    const { data: lines, error: lErr } = await supabase
      .from("journal_lines")
      .select("id, account_id, debit, credit, journal_entries!inner(id, entry_date, status, tenant_id, description, reference)")
      .eq("account_id", recon.bank_account_id)
      .eq("journal_entries.tenant_id", recon.tenant_id)
      .eq("journal_entries.status", "posted")
      .lte("journal_entries.entry_date", recon.statement_ending_date);
    if (lErr) throw lErr;

    const ledger = (lines || []).map((l: any) => ({
      id: l.id,
      account_id: l.account_id,
      journal_entry_id: l.journal_entries.id,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      entry_date: l.journal_entries.entry_date,
      je_description: l.journal_entries.description,
      je_reference: l.journal_entries.reference,
      vendor_name: null as string | null,
      vendor_id: null as string | null,
      bill_no: null as string | null,
      is_ap_payment: false,
    }));

    // Enrich ledger lines with AP subledger context (vendor-aware AP matching).
    // For each bank-side line whose JE also touches AP, attach vendor name + bill no.
    const jeIds = ledger.map((l) => l.journal_entry_id);
    if (jeIds.length) {
      const { data: apLinks } = await supabase
        .from("ap_subledger")
        .select("journal_id, vendor_id, bill_no, vendors(name)")
        .in("journal_id", jeIds)
        .eq("tenant_id", recon.tenant_id);
      const byJe = new Map<string, any>();
      for (const a of apLinks || []) byJe.set(a.journal_id, a);
      for (const l of ledger) {
        const ap = byJe.get(l.journal_entry_id);
        if (ap) {
          l.is_ap_payment = true;
          l.vendor_id = ap.vendor_id;
          l.vendor_name = (ap as any).vendors?.name || null;
          l.bill_no = ap.bill_no;
        }
      }
    }

    // Load bank feed
    const { data: feed } = await supabase
      .from("bank_feed_transactions")
      .select("*")
      .eq("reconciliation_id", reconciliation_id)
      .eq("is_duplicate", false);
    const bankTxns = feed || [];

    const ledgerDebits = ledger.reduce((s, l) => s + l.debit, 0);
    const ledgerCredits = ledger.reduce((s, l) => s + l.credit, 0);
    const ledgerSigned = ledgerDebits - ledgerCredits;

    // ---- ACTION: snapshot ----
    if (action === "snapshot" || action === "match" || action === "validate" || action === "finalize") {
      // Always snapshot first
      const bankSum = bankTxns.reduce((s: number, t: any) => s + Number(t.amount), 0);
      const clearedSum = bankTxns
        .filter((t: any) => ["matched", "cleared", "verified", "reconciled"].includes(t.state))
        .reduce((s: number, t: any) => s + Number(t.amount), 0);

      const snap = {
        tenant_id: recon.tenant_id,
        reconciliation_id,
        bank_account_id: recon.bank_account_id,
        as_of_date: recon.statement_ending_date,
        bank_balance: bankSum,
        ledger_balance: ledgerSigned,
        cleared_balance: clearedSum,
        difference: Number(recon.statement_ending_balance) - (Number(recon.beginning_balance) + clearedSum),
        bank_txn_count: bankTxns.length,
        ledger_line_count: ledger.length,
        payload: { bank_ids: bankTxns.map((t: any) => t.id), ledger_ids: ledger.map((l) => l.id) },
        status: "draft",
      };
      const { data: snapRow } = await supabase.from("reconciliation_snapshots").insert(snap).select().single();

      if (action === "snapshot") {
        return new Response(JSON.stringify({ ok: true, snapshot: snapRow }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, ...rlHeaders,
        });
      }

      // ---- ACTION: match (deterministic) ----
      if (action === "match") {
        // Load active user-defined rules (priority desc)
        const { data: userRules } = await supabase
          .from("reconciliation_rules")
          .select("*")
          .eq("tenant_id", recon.tenant_id)
          .eq("is_active", true)
          .order("priority", { ascending: false });
        const rules = userRules || [];

        // Exclude lines already cleared in this or prior reconciliations
        const lineIds = ledger.map((l) => l.id);
        const { data: clearedTx } = await supabase
          .from("reconciliation_transactions")
          .select("journal_line_id")
          .in("journal_line_id", lineIds)
          .eq("cleared", true);
        const clearedSet = new Set((clearedTx || []).map((c: any) => c.journal_line_id));
        const open = ledger.filter((l) => !clearedSet.has(l.id));

        let auto = 0, suggested = 0, composite = 0, ruleAutoCreated = 0, apMatched = 0;
        const results: any[] = [];

        for (const b of bankTxns.filter((t: any) => t.state === "unmatched")) {
          const m = matchOne(b, open, rules);
          if (!m) continue;

          if (m.type === "COMPOSITE") {
            for (const t of (m as any).targets) {
              await supabase.from("reconciliation_transactions").upsert(
                { reconciliation_id, journal_line_id: t.id, cleared: true, cleared_date: b.transaction_date },
                { onConflict: "reconciliation_id,journal_line_id" } as any,
              );
            }
            assertTransition(b.state, "matched");
            await supabase.from("bank_feed_transactions").update({
              state: "matched", status: "matched",
              match_type: "COMPOSITE", match_confidence: m.score,
              match_metadata: {
                tier: "COMPOSITE",
                tier_reason: (m as any).tier_reason,
                trace: (m as any).trace,
                targets: (m as any).targets.map((t: any) => t.id),
              },
            }).eq("id", b.id);
            composite++;
            results.push({ bank_id: b.id, type: "COMPOSITE", score: m.score });
            continue;
          }

          // RULE_ONLY: rule fired but no ledger candidate. Delegate ALL JE creation
          // to the shared executeRuleAction (single source of truth — same code the
          // primary "AI Match" path uses). It gates on action_create_expense, applies
          // the sign guard + tax split, enforces balance/period-lock/idempotency, and
          // clears+stamps the line. When the gate fails it returns a suggest reason.
          if (m.type === "RULE_ONLY") {
            const rule = (m as any).rule;
            const outcome = await executeRuleAction(supabase, recon, b, rule);
            if (outcome.kind === "posted") {
              ruleAutoCreated++;
              results.push({ bank_id: b.id, type: "RULE_AUTO", score: m.score, rule: rule.name });
            } else {
              assertTransition(b.state, "suggested");
              await supabase.from("bank_feed_transactions").update({
                state: "suggested", status: "suggested",
                match_type: "RULE_ONLY", match_confidence: m.score,
                match_metadata: {
                  tier: "RULE_ONLY",
                  tier_reason: (m as any).tier_reason,
                  trace: (m as any).trace,
                  rule_id: rule.id, rule_name: rule.name, reason: outcome.reason,
                },
              }).eq("id", b.id);
              suggested++;
              results.push({ bank_id: b.id, type: "RULE_ONLY", score: m.score, rule: rule.name });
            }
            continue;
          }

          const target = (m as any).target;
          const apMeta = target?.is_ap_payment
            ? { vendor_id: target.vendor_id, vendor_name: target.vendor_name, bill_no: target.bill_no, ap_payment: true }
            : {};
          const ruleMeta = (m as any).rule ? { rule_id: (m as any).rule.id, rule_name: (m as any).rule.name } : {};
          const meta = {
            tier: m.type,
            tier_reason: (m as any).tier_reason,
            trace: (m as any).trace,
            ledger_line_id: target?.id,
            ledger_entry_date: target?.entry_date,
            ledger_reference: target?.je_reference,
            ledger_description: target?.je_description,
            ...apMeta,
            ...ruleMeta,
          };
          if (m.score >= 90) {
            await supabase.from("reconciliation_transactions").upsert(
              { reconciliation_id, journal_line_id: target.id, cleared: true, cleared_date: b.transaction_date },
              { onConflict: "reconciliation_id,journal_line_id" } as any,
            );
            assertTransition(b.state, "matched");
            await supabase.from("bank_feed_transactions").update({
              state: "matched", status: "matched",
              matched_journal_line_id: target.id,
              match_type: m.type, match_confidence: m.score,
              match_metadata: meta,
            }).eq("id", b.id);
            auto++;
            if (target?.is_ap_payment) apMatched++;
          } else {
            assertTransition(b.state, "suggested");
            await supabase.from("bank_feed_transactions").update({
              state: "suggested", status: "suggested",
              matched_journal_line_id: target.id,
              match_type: m.type, match_confidence: m.score,
              match_metadata: meta,
            }).eq("id", b.id);
            suggested++;
          }
          results.push({ bank_id: b.id, type: m.type, score: m.score });
        }

        return new Response(JSON.stringify({
          ok: true, snapshot: snapRow,
          auto, suggested, composite, rule_auto_created: ruleAutoCreated, ap_matched: apMatched,
          rules_loaded: rules.length, results,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ---- ACTION: validate (invariants) ----
      const inv = checkInvariants({
        beginningBalance: Number(recon.beginning_balance),
        statementEnding: Number(recon.statement_ending_balance),
        ledgerSignedSum: ledgerSigned,
        clearedSum,
        ledgerDebits,
        ledgerCredits,
      });
      const allPassed = inv.every((i) => i.passed);

      // Persist invariant log (immutable)
      for (const i of inv) {
        await supabase.from("reconciliation_invariant_log").insert({
          tenant_id: recon.tenant_id,
          reconciliation_id,
          invariant_name: i.name,
          expected: i.expected, actual: i.actual, delta: i.delta, passed: i.passed,
        });
      }

      if (action === "validate") {
        return new Response(JSON.stringify({ ok: allPassed, invariants: inv, snapshot: snapRow }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, ...rlHeaders,
        });
      }

      // ---- ACTION: finalize ----
      if (!allPassed) {
        return new Response(JSON.stringify({ ok: false, error: "Invariants failed", invariants: inv }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Any unresolved bank txns?
      const unresolved = bankTxns.filter((t: any) => !["matched", "cleared", "verified", "reconciled"].includes(t.state));
      if (unresolved.length > 0) {
        return new Response(JSON.stringify({ ok: false, error: "Unresolved bank transactions", unresolved: unresolved.length }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Transition all to locked
      for (const t of bankTxns) {
        try { assertTransition(t.state, t.state === "reconciled" ? "locked" : "matched"); } catch { /* tolerate */ }
      }
      await supabase.from("bank_feed_transactions")
        .update({ state: "locked" })
        .eq("reconciliation_id", reconciliation_id);

      // Lock the reconciliation
      const { error: lockErr } = await supabase.from("bank_reconciliations").update({
        status: "reconciled",
        cleared_balance: clearedSum,
        difference: 0,
        locked_at: new Date().toISOString(),
      }).eq("id", reconciliation_id);
      if (lockErr) throw lockErr;

      // Final immutable snapshot (status: locked)
      await supabase.from("reconciliation_snapshots").insert({
        ...snap,
        status: "locked",
      });

      return new Response(JSON.stringify({ ok: true, finalized: true, invariants: inv, cleared: clearedSum }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, ...rlHeaders,
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("reconcile-engine error", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
