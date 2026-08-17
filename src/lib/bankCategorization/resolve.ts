/**
 * The resolution ladder. Strict order, first match wins, matched rule /
 * mapping ID always recorded.
 *
 *   Blocked  — corrupt data: cannot legally post anywhere, including Suspense.
 *   Tier 1   — normalized account_type → canonical category → tenant mapping.
 *   Tier 1b  — account_type matches a real ledger account's name/code directly
 *              (unique match only) — catches accounts not in the variant map.
 *   Tier 2   — no account_type: exact normalized description/name rule match.
 *   Tier 4   — nothing matched but the description is usable: a ledger named
 *              from the description is auto-generated (classified by direction).
 *   Tier 3   — Suspense, with a reason code, when even a name can't be derived
 *              or the row is structurally risky (future/over-ceiling/…).
 */

import { normalizeText } from "./normalize.ts";
import { canonicalize } from "./canonicalize.ts";
import { deriveAccountName, deriveNameFromLabel } from "./derive.ts";
import {
  MAX_POSTABLE_AMOUNT,
  SUSPENSE_CATEGORY,
  type AccountMeta,
  type ParsedLine,
  type Resolution,
  type ResolutionContext,
  type Side,
  type Suggestion,
  type SuspenseReason,
} from "./types.ts";

// ── Tier 1b: match the account_type directly against real ledger accounts ─────
// Statements routinely put the destination account's own NAME (or code) in the
// account_type column — "Bank Charges", "WHT Receivable", "Salaries". Those
// won't be in the curated canonical map, yet the ledger already exists, so we
// match the text against the tenant's account names/codes. Exact and plural /
// word-order tolerant, but only when the match is UNIQUE — never a guess.
interface AccountNameIndex {
  byName: Map<string, string[]>;     // normalized account name → account ids
  byCode: Map<string, string>;       // normalized account code → account id
  byTokenSet: Map<string, string[]>; // singularized token-set key → account ids
}
const _indexCache = new WeakMap<Map<string, AccountMeta>, AccountNameIndex>();
const NAME_FILLERS = new Set(["of", "the", "and", "a", "an", "to", "for"]);

// Multi-word finance/tax terms and their standard acronym, so an account named
// "Withholding Tax Receivable" and an account_type "WHT Receivables" resolve to
// the SAME key. Applied to both sides before tokenizing. Deterministic, curated.
const PHRASE_SYNONYMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bwith\s*holding\s+tax\b/g, "wht"],
  [/\bvalue\s+added\s+tax\b/g, "vat"],
  [/\bnation\s+building\s+tax\b/g, "nbt"],
  [/\beconomic\s+service\s+charge\b/g, "esc"],
  [/\bpay\s+as\s+you\s+earn\b/g, "paye"],
];

function singular(w: string): string {
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

/**
 * Order-independent, plural-insensitive key: the SET of significant words.
 * Also collapses spaced/dotted acronyms ("W.H.T"/"W H T" → "wht") and applies
 * curated phrase synonyms, so spelling variants of the same account map to one
 * key and post to the same ledger.
 */
function tokenSetKey(norm: string): string {
  let s = norm;
  for (const [re, rep] of PHRASE_SYNONYMS) s = s.replace(re, rep);
  const raw = s.split(/[^a-z0-9]+/i).filter(Boolean);
  // Merge runs of single letters into one acronym token: ["w","h","t"] → "wht".
  const merged: string[] = [];
  let acc = "";
  for (const t of raw) {
    if (t.length === 1 && /[a-z]/i.test(t)) { acc += t; continue; }
    if (acc) { merged.push(acc); acc = ""; }
    merged.push(t);
  }
  if (acc) merged.push(acc);
  const toks = merged
    .filter((t) => !NAME_FILLERS.has(t))
    .map(singular)
    .filter((t) => t && !NAME_FILLERS.has(t));
  return [...new Set(toks)].sort().join(" ");
}

function pushInto(map: Map<string, string[]>, key: string, id: string): void {
  const arr = map.get(key);
  if (arr) arr.push(id); else map.set(key, [id]);
}

function buildAccountNameIndex(accounts: Map<string, AccountMeta>): AccountNameIndex {
  const cached = _indexCache.get(accounts);
  if (cached) return cached;
  const idx: AccountNameIndex = { byName: new Map(), byCode: new Map(), byTokenSet: new Map() };
  for (const a of accounts.values()) {
    if (!a.isActive || !a.isPostable || a.isControlAccount) continue; // only real posting targets
    if (a.accountName) {
      const n = normalizeText(a.accountName);
      if (n) {
        pushInto(idx.byName, n, a.id);
        const ts = tokenSetKey(n);
        if (ts) pushInto(idx.byTokenSet, ts, a.id);
      }
    }
    if (a.accountCode) {
      const c = normalizeText(a.accountCode);
      if (c && !idx.byCode.has(c)) idx.byCode.set(c, a.id);
    }
  }
  _indexCache.set(accounts, idx);
  return idx;
}

/** Resolve one text value to a real ledger account id, or null. Only returns on
 * a UNIQUE match so an ambiguous name never silently mis-posts. */
function matchAccountByType(normType: string, ctx: ResolutionContext): string | null {
  const idx = buildAccountNameIndex(ctx.accounts);
  const byCode = idx.byCode.get(normType);
  if (byCode) return byCode;
  const byName = idx.byName.get(normType);
  if (byName && new Set(byName).size === 1) return byName[0];
  const ts = tokenSetKey(normType);
  if (ts) {
    const byTs = idx.byTokenSet.get(ts);
    if (byTs && new Set(byTs).size === 1) return byTs[0];
  }
  return null;
}

/**
 * Match a line to an existing ledger using ANY of its identifying text —
 * account_type first (the category), then description, then payee name.
 *
 * Layout-agnostic on purpose: bank/COA exports put the category ("Bank Charges",
 * "WHT Receivables") in whichever column, and header detection can't always tell
 * the category column from the description column. Trying all three means a row
 * whose category names a real ledger posts there regardless of which slot the
 * parser mapped it to — so all 16 "Bank Charges" rows land in Bank Charges, not
 * just the one that happened to match a curated variant.
 */
function matchLineToAccount(line: ParsedLine, ctx: ResolutionContext): string | null {
  for (const raw of [line.rawAccountType, line.description, line.name]) {
    const norm = normalizeText(raw);
    if (!norm) continue;
    const id = matchAccountByType(norm, ctx);
    if (id) return id;
  }
  return null;
}

function suspense(reason: SuspenseReason, suggestions: Suggestion[] = []): Resolution {
  return { kind: "suspense", reason, suggestions };
}

/** An account_type explicitly marked as suspense — "Suspense", "Suspenses",
 * "Suspense Peoples Saving", … — must go to Suspense Clearing for manual
 * review, never be auto-matched or derived. Matches the whole word (plural
 * "s" allowed — a real ledger literally named "... Suspenses" would otherwise
 * word-match Tier 1b and post there directly, skipping the review flag) so
 * "Suspend"/"Suspension" still don't trip it. */
function isSuspenseLabel(normalizedType: string): boolean {
  return /\bsuspenses?\b/.test(normalizedType);
}

/**
 * Last resort before Suspense: auto-generate a ledger (Tier 4). The name comes
 * from the account_type LABEL when present (it's the curated category — "Bank
 * Charges", "Peoples Saving"), else from the description. Falls back to Suspense
 * with the original reason when neither yields anything usable — a junk name is
 * never posted.
 */
function deriveOrSuspense(line: ParsedLine, side: Side, fallback: SuspenseReason): Resolution {
  const accountName = deriveNameFromLabel(line.rawAccountType) || deriveAccountName(line.description, line.name);
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

/**
 * A footer TOTAL / subtotal row rather than a transaction: it carries money but
 * NOTHING that identifies a transaction — no printed date (a forward-filled one
 * doesn't count), no description, no name, no voucher, no account type.
 *
 * Real statements never produce that shape; spreadsheet footers always do. A
 * live import posted a Rs 438,219,700.68 subtotal row as an expense because the
 * only other footer guard was `both_sides_populated`, and that row had just the
 * debit filled. Detected here so the row is HELD and visible rather than
 * silently doubling the ledger — and so its amount can be reconciled against
 * what actually posted (see `reconcileTotals`).
 */
export function isTotalsRow(line: ParsedLine): boolean {
  const hasAmount =
    (Number.isFinite(line.debit) && line.debit > 0) ||
    (Number.isFinite(line.credit) && line.credit > 0);
  if (!hasAmount) return false;
  return (
    line.rawDate.trim() === "" &&
    line.description.trim() === "" &&
    line.name.trim() === "" &&
    line.voucherNo.trim() === "" &&
    line.rawAccountType.trim() === ""
  );
}

export function classifyLine(line: ParsedLine, ctx: ResolutionContext): Resolution {
  // ── Blocked gates: corrupt data posts nowhere ─────────────────────────
  // Checked before the amount gates so every footer row reports the accurate
  // reason, not whichever corruption gate happens to fire first.
  if (isTotalsRow(line)) {
    return { kind: "blocked", reason: "totals_row" };
  }
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
  const rawCat = normalizeText(line.rawAccountType);
  const rawDesc = normalizeText(line.description);

  // ── Suspense-marked → Suspense Clearing ──────────────────────────────
  // The word "suspense" in the category — whichever column the parser mapped it
  // to (account_type or description) — routes the row to Suspense for manual
  // review. Everything else is caught or auto-generated below.
  if (isSuspenseLabel(rawCat) || isSuspenseLabel(rawDesc)) {
    return suspense("source_marked_suspense");
  }

  // ── Tier 1: account_type → canonical → tenant category mapping ───────
  if (rawCat) {
    const canonEntry = canonicalize(rawCat, ctx.canonicalMap);
    if (canonEntry && canonEntry.canonicalCategory === SUSPENSE_CATEGORY) {
      return suspense("source_marked_suspense");
    }
    const mapping = canonEntry ? ctx.accountMap.get(canonEntry.canonicalCategory) : undefined;
    if (mapping) {
      if (!mapping.isActive) return suspense("inactive_account_mapping");
      const acctGate = gateAccount(mapping.accountId, ctx);
      if (acctGate) return acctGate;
      if (mapping.expectedSide !== "either" && mapping.expectedSide !== side) {
        return suspense("side_mismatch", [
          { accountId: mapping.accountId, label: canonEntry!.canonicalCategory, source: "side_mismatch" },
        ]);
      }
      return { kind: "resolved", accountId: mapping.accountId, ruleId: mapping.id, tier: 1 };
    }

    // ── Tier 1b: the line names a real ledger (via account_type, description,
    // or name) — catches accounts the tenant already has that aren't in the
    // curated variant map, wherever the category text landed. No side gate.
    const directId = matchLineToAccount(line, ctx);
    if (directId) {
      return { kind: "resolved", accountId: directId, ruleId: null, tier: 1 };
    }

    // account_type present but neither mapped nor a known account → derive a
    // ledger from the label (or description) rather than parking it.
    return deriveOrSuspense(line, side, canonEntry ? "unmapped_category" : "unknown_category_variant");
  }

  // ── Tier 2: exact rule on normalized description (or name if empty) ───
  const normDesc = rawDesc || normalizeText(line.name);
  const normName = normalizeText(line.name);
  if (!normDesc && !normName) return deriveOrSuspense(line, side, "no_category_no_rule");

  const candidates = ctx.rules.filter(
    (r) =>
      r.isActive &&
      r.matchValue !== "" &&
      r.matchValue === (r.matchField === "name" ? normName : normDesc)
  );
  if (candidates.length === 0) {
    // No account_type and no rule — but the description/name may itself name a
    // real ledger ("WHT Receivables" with no account_type column). Match it
    // before falling back to an auto-generated ledger.
    const directId = matchLineToAccount(line, ctx);
    if (directId) return { kind: "resolved", accountId: directId, ruleId: null, tier: 1 };
    return deriveOrSuspense(line, side, "no_category_no_rule");
  }

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
