import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface BankFeedTxn {
  id: string;
  transaction_date: string;
  description: string;
  amount: number;
  reference_number: string | null;
}

interface LedgerTxn {
  id: string;
  entry_date: string;
  description: string;
  reference: string | null;
  debit: number;
  credit: number;
  journal_line_id: string;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const sa = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const sb = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (sa === sb) return 1;
  if (sa.includes(sb) || sb.includes(sa)) return 0.7;
  // Jaccard on trigrams
  const trigramsA = new Set<string>();
  const trigramsB = new Set<string>();
  for (let i = 0; i <= sa.length - 3; i++) trigramsA.add(sa.slice(i, i + 3));
  for (let i = 0; i <= sb.length - 3; i++) trigramsB.add(sb.slice(i, i + 3));
  if (trigramsA.size === 0 || trigramsB.size === 0) return 0;
  let intersection = 0;
  trigramsA.forEach((t) => { if (trigramsB.has(t)) intersection++; });
  return intersection / (trigramsA.size + trigramsB.size - intersection);
}

function matchScore(bankTxn: BankFeedTxn, ledgerTxn: LedgerTxn): number {
  let score = 0;
  const bankAmount = Math.abs(bankTxn.amount);
  const ledgerAmount = bankTxn.amount > 0 ? ledgerTxn.debit : ledgerTxn.credit;

  // Amount match (most important - 40%)
  if (Math.abs(bankAmount - ledgerAmount) < 0.01) score += 0.4;
  else if (Math.abs(bankAmount - ledgerAmount) / Math.max(bankAmount, 1) < 0.01) score += 0.3;
  else return 0; // Amount must be reasonably close

  // Date proximity (25%)
  const bankDate = new Date(bankTxn.transaction_date).getTime();
  const ledgerDate = new Date(ledgerTxn.entry_date).getTime();
  const daysDiff = Math.abs(bankDate - ledgerDate) / (1000 * 60 * 60 * 24);
  if (daysDiff === 0) score += 0.25;
  else if (daysDiff <= 1) score += 0.2;
  else if (daysDiff <= 3) score += 0.15;
  else if (daysDiff <= 7) score += 0.05;

  // Description similarity (20%)
  const descSim = similarity(bankTxn.description || "", ledgerTxn.description || "");
  score += descSim * 0.2;

  // Reference match (15%)
  if (bankTxn.reference_number && ledgerTxn.reference) {
    const refSim = similarity(bankTxn.reference_number, ledgerTxn.reference);
    score += refSim * 0.15;
  }

  return score;
}

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
      return new Response(JSON.stringify({ error: "Missing parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get unmatched bank feed transactions
    const { data: bankFeeds, error: bfError } = await supabase
      .from("bank_feed_transactions")
      .select("id, transaction_date, description, amount, reference_number")
      .eq("reconciliation_id", reconciliation_id)
      .eq("status", "unmatched")
      .eq("is_duplicate", false);
    if (bfError) throw bfError;

    // Get uncleared reconciliation transactions (ledger side)
    const { data: reconTxns, error: rtError } = await supabase
      .from("reconciliation_transactions")
      .select("id, journal_line_id, cleared, journal_lines(id, debit, credit, journal_entries(entry_date, description, reference))")
      .eq("reconciliation_id", reconciliation_id)
      .eq("cleared", false);
    if (rtError) throw rtError;

    // Build ledger transactions list
    const ledgerTxns: (LedgerTxn & { recon_txn_id: string })[] = (reconTxns || []).map((rt: any) => ({
      id: rt.journal_lines?.id,
      entry_date: rt.journal_lines?.journal_entries?.entry_date,
      description: rt.journal_lines?.journal_entries?.description,
      reference: rt.journal_lines?.journal_entries?.reference,
      debit: Number(rt.journal_lines?.debit) || 0,
      credit: Number(rt.journal_lines?.credit) || 0,
      journal_line_id: rt.journal_line_id,
      recon_txn_id: rt.id,
    }));

    // Match each bank feed against each ledger transaction
    const matches: Array<{
      bank_feed_id: string;
      recon_txn_id: string;
      journal_line_id: string;
      confidence: number;
    }> = [];

    const usedLedger = new Set<string>();
    const usedBank = new Set<string>();

    // Build all possible matches
    const allScores: Array<{
      bank_feed_id: string;
      recon_txn_id: string;
      journal_line_id: string;
      score: number;
    }> = [];

    for (const bf of (bankFeeds || [])) {
      for (const lt of ledgerTxns) {
        const score = matchScore(bf, lt);
        if (score >= 0.4) {
          allScores.push({
            bank_feed_id: bf.id,
            recon_txn_id: lt.recon_txn_id,
            journal_line_id: lt.journal_line_id,
            score,
          });
        }
      }
    }

    // Sort by score descending, greedy match
    allScores.sort((a, b) => b.score - a.score);
    for (const s of allScores) {
      if (usedBank.has(s.bank_feed_id) || usedLedger.has(s.recon_txn_id)) continue;
      usedBank.add(s.bank_feed_id);
      usedLedger.add(s.recon_txn_id);
      matches.push({
        bank_feed_id: s.bank_feed_id,
        recon_txn_id: s.recon_txn_id,
        journal_line_id: s.journal_line_id,
        confidence: Math.round(s.score * 100),
      });
    }

    // Update bank feed transactions with suggested matches
    for (const m of matches) {
      await supabase
        .from("bank_feed_transactions")
        .update({
          status: "suggested",
          matched_journal_line_id: m.journal_line_id,
          match_confidence: m.confidence,
        })
        .eq("id", m.bank_feed_id);
    }

    // Also apply rules
    const { data: rules } = await supabase
      .from("reconciliation_rules")
      .select("*")
      .eq("is_active", true)
      .order("priority", { ascending: false });

    let rulesApplied = 0;
    const unmatchedFeeds = (bankFeeds || []).filter((bf: any) => !usedBank.has(bf.id));

    for (const bf of unmatchedFeeds) {
      for (const rule of (rules || [])) {
        let conditionMet = false;
        const desc = (bf.description || "").toLowerCase();
        const val = (rule.condition_value || "").toLowerCase();

        if (rule.condition_field === "description") {
          if (rule.condition_operator === "contains" && desc.includes(val)) conditionMet = true;
          if (rule.condition_operator === "equals" && desc === val) conditionMet = true;
        }
        if (rule.condition_field === "amount") {
          const amt = Math.abs(bf.amount);
          if (rule.condition_operator === "range" && rule.condition_amount_min != null && rule.condition_amount_max != null) {
            conditionMet = amt >= rule.condition_amount_min && amt <= rule.condition_amount_max;
          }
          if (rule.condition_operator === "equals" && Math.abs(amt - parseFloat(val)) < 0.01) conditionMet = true;
        }

        if (conditionMet) {
          await supabase
            .from("bank_feed_transactions")
            .update({ status: "rule_matched" })
            .eq("id", bf.id);
          rulesApplied++;
          break;
        }
      }
    }

    return new Response(JSON.stringify({ 
      matches: matches.length, 
      rules_applied: rulesApplied,
      match_details: matches 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("match-transactions error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
