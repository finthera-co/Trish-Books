/**
 * The resolution ladder. Strict order, first match wins, matched rule /
 * mapping ID always recorded.
 *
 *   Blocked  — corrupt data: cannot legally post anywhere, including Suspense.
 *   Tier 1   — normalized account_type → canonical category → tenant mapping.
 *   Tier 2   — no account_type: exact normalized description/name rule match.
 *   Tier 4   — nothing matched but the description is usable: a ledger named
 *              from the description is auto-generated (classified by direction).
 *   Tier 3   — Suspense, with a reason code, when even a name can't be derived
 *              or the row is structurally risky (future/over-ceiling/…).
 */

import { normalizeText } from "./normalize.ts";
import { canonicalize } from "./canonicalize.ts";
import { deriveAccountName } from "./derive.ts";
import {
  MAX_POSTABLE_AMOUNT,
  SUSPENSE_CATEGORY,
  type ParsedLine,
  type Resolution,
  type ResolutionContext,
  type Side,
  type Suggestion,
  type SuspenseReason,
} from "./types.ts";

function suspense(reason: SuspenseReason, suggestions: Suggestion[] = []): Resolution {
  return { kind: "suspense", reason, suggestions };
}

/**
 * Last resort before Suspense: when no mapping or rule matched, turn the
 * description into an auto-generated ledger (Tier 4). Falls back to Suspense
 * with the original reason when the description yields nothing usable (all
 * numeric / all noise) — a junk name is never posted.
 */
function deriveOrSuspense(line: ParsedLine, side: Side, fallback: SuspenseReason): Resolution {
  const accountName = deriveAccountName(line.description, line.name);
  if (accountName) return { kind: "derive", accountName, side };
  return suspense(fallback);
}

function lineSide(line: ParsedLine): Side {
  return line.debit > 0 ? "debit" : "credit";
}

function dateInPeriod(isoDate: string, month: number, year: number): boolean {
  const [y, m] = isoDate.split("-").map(Number);
  return y === year && m === month;
}

/** Gate a candidate mapping's target account; returns a suspense Resolution
 * when the account is unusable, or null when it is fine to post to. */
function gateAccount(accountId: string, ctx: ResolutionContext): Resolution | null {
  const acct = ctx.accounts.get(accountId);
  if (!acct || !acct.isActive || !acct.isPostable) {
    return suspense("inactive_account_mapping");
  }
  return null;
}

export function classifyLine(line: ParsedLine, ctx: ResolutionContext): Resolution {
  // ── Blocked gates: corrupt data posts nowhere ─────────────────────────
  if (!Number.isFinite(line.debit) || !Number.isFinite(line.credit) || line.debit < 0 || line.credit < 0) {
    return { kind: "blocked", reason: "invalid_amount" };
  }
  if (line.debit > 0 && line.credit > 0) {
    return { kind: "blocked", reason: "both_sides_populated" };
  }
  if (line.debit === 0 && line.credit === 0) {
    return { kind: "blocked", reason: "no_amount" };
  }
  // Above NUMERIC(14,2) the ledger would silently truncate — refuse to post.
  if (line.debit >= MAX_POSTABLE_AMOUNT || line.credit >= MAX_POSTABLE_AMOUNT) {
    return { kind: "blocked", reason: "amount_overflow" };
  }
  if (!line.txnDate) {
    return { kind: "blocked", reason: "unparseable_date" };
  }

  // ── Suspense gates that apply even when a rule would match ────────────
  if (ctx.maxDate && line.txnDate > ctx.maxDate) {
    return suspense("future_date");
  }
  if (!dateInPeriod(line.txnDate, line.periodMonth, line.periodYear)) {
    return suspense("out_of_period_date");
  }
  const amount = line.debit > 0 ? line.debit : line.credit;
  if (amount > ctx.amountCeiling) {
    return suspense("amount_over_ceiling");
  }

  const side = lineSide(line);

  // ── Tier 1: account_type → canonical → tenant category mapping ───────
  const rawCat = normalizeText(line.rawAccountType);
  if (rawCat) {
    const canonEntry = canonicalize(rawCat, ctx.canonicalMap);
    // account_type present but unrecognized → derive a ledger from the
    // description rather than parking it (its nature is still the description).
    if (!canonEntry) return deriveOrSuspense(line, side, "unknown_category_variant");
    if (canonEntry.canonicalCategory === SUSPENSE_CATEGORY) {
      return suspense("source_marked_suspense");
    }
    const mapping = ctx.accountMap.get(canonEntry.canonicalCategory);
    // Known category the tenant has not mapped to an account yet → derive.
    if (!mapping) return deriveOrSuspense(line, side, "unmapped_category");
    if (!mapping.isActive) return suspense("inactive_account_mapping");
    const acctGate = gateAccount(mapping.accountId, ctx);
    if (acctGate) return acctGate;
    if (mapping.expectedSide !== "either" && mapping.expectedSide !== side) {
      return suspense("side_mismatch", [
        { accountId: mapping.accountId, label: canonEntry.canonicalCategory, source: "side_mismatch" },
      ]);
    }
    return { kind: "resolved", accountId: mapping.accountId, ruleId: mapping.id, tier: 1 };
  }

  // ── Tier 2: exact rule on normalized description (or name if empty) ───
  const normDesc = normalizeText(line.description) || normalizeText(line.name);
  const normName = normalizeText(line.name);
  if (!normDesc && !normName) return deriveOrSuspense(line, side, "no_category_no_rule");

  const candidates = ctx.rules.filter(
    (r) =>
      r.isActive &&
      r.matchValue !== "" &&
      r.matchValue === (r.matchField === "name" ? normName : normDesc)
  );
  // No account_type and no rule matched → derive a ledger from the description.
  if (candidates.length === 0) return deriveOrSuspense(line, side, "no_category_no_rule");

  const topPriority = Math.min(...candidates.map((r) => r.priority));
  const winners = candidates.filter((r) => r.priority === topPriority);
  if (winners.length > 1) {
    // Never silent first-wins on a tie — surface the conflict.
    return suspense(
      "conflicting_rules",
      winners.map((r) => ({ accountId: r.accountId, label: r.matchValue, source: "conflicting_rule" }))
    );
  }

  const rule = winners[0];
  const acctGate = gateAccount(rule.accountId, ctx);
  if (acctGate) return acctGate;
  if (rule.expectedSide !== "either" && rule.expectedSide !== side) {
    return suspense("side_mismatch", [
      { accountId: rule.accountId, label: rule.matchValue, source: "side_mismatch" },
    ]);
  }
  return { kind: "resolved", accountId: rule.accountId, ruleId: rule.id, tier: 2 };
}
