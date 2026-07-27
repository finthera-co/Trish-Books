/**
 * Derive a clean, human-readable ledger account NAME from a bank statement
 * description.
 *
 * Deterministic and idempotent: the same description always yields the same
 * name, and two descriptions that differ only in reference numbers / dates
 * collapse onto the same name — so repeated payees reuse ONE auto-generated
 * ledger instead of spawning one per row.
 *
 * This is the only place the engine turns free text into an account, and it is
 * deliberately narrow: it decides what to CALL the ledger, never what the
 * account MEANS. Classification (Expense vs Income, hence the Dr/Cr side) is
 * fixed by cash direction in resolve.ts, not inferred from this text.
 */

import { normalizeText } from "./normalize.ts";

// A derived name is a label, not a sentence: cap the words and length so a
// verbose memo ("payment to keells super for june groceries ref 8821") becomes
// a tidy ledger name rather than a paragraph.
const MAX_NAME_WORDS = 6;
const MAX_NAME_LEN = 60;

// Generic banking / instrument / reference words that carry no accounting
// meaning. Kept deliberately tight — anything that could be the NATURE of a
// payment (water, rent, internet, loan…) is preserved so the name stays true
// to the description. Only transactional plumbing and stop-words are dropped.
const NOISE_WORDS = new Set([
  "ref", "reference", "txn", "trx", "trans", "transaction", "trf", "tfr", "rtgs",
  "chq", "cheque", "cheq", "chk", "no", "number", "inv", "invoice", "vide",
  "being", "via", "slip", "slips", "online", "payment", "pymt", "pmt", "pay",
  "paid", "bank", "acct", "account", "ac", "the", "and", "of", "to", "from",
  "for", "at", "on", "by",
]);

function cleanTokens(raw: string): string[] {
  const norm = normalizeText(raw); // lower-cased, whitespace-collapsed, trimmed
  if (!norm) return [];
  const kept: string[] = [];
  for (const t of norm.split(/[^a-z0-9&]+/i).filter(Boolean)) {
    if (t === "&") { kept.push(t); continue; }
    if (/^\d+$/.test(t)) continue;              // pure numbers: 88213, 000451
    if (/\d/.test(t) && t.length >= 5) continue; // ref-like codes: ab12cd34
    if (t.length <= 1) continue;                 // stray single letters
    if (NOISE_WORDS.has(t)) continue;
    kept.push(t);
  }
  // A leading/trailing "&" left after dropping neighbours is meaningless.
  while (kept.length && kept[0] === "&") kept.shift();
  while (kept.length && kept[kept.length - 1] === "&") kept.pop();
  return kept;
}

function titleCase(tokens: string[]): string {
  return tokens
    .map((t) => (t === "&" ? "&" : t.charAt(0).toUpperCase() + t.slice(1)))
    .join(" ");
}

/**
 * Turn a description (falling back to the payee name) into a Title-Cased ledger
 * name. Returns "" when nothing meaningful survives — an all-numeric or
 * all-noise description — so the caller keeps that row in Suspense rather than
 * minting a junk account.
 */
export function deriveAccountName(
  description: string | null | undefined,
  fallbackName?: string | null,
): string {
  let tokens = cleanTokens(description ?? "");
  if (tokens.length === 0) tokens = cleanTokens(fallbackName ?? "");
  if (tokens.length === 0) return "";
  let name = titleCase(tokens.slice(0, MAX_NAME_WORDS));
  if (name.length > MAX_NAME_LEN) name = name.slice(0, MAX_NAME_LEN).trimEnd();
  return name;
}

/**
 * Clean a category LABEL — the `account_type` column — into a ledger name.
 *
 * Unlike deriveAccountName (built for free-text descriptions, which strips
 * reference numbers and generic words like "bank"/"payment"), a label is
 * already a curated category, so EVERY word is kept: "Bank Charges" stays "Bank
 * Charges", "Suspense Peoples Saving" stays "Suspense Peoples Saving". Only
 * whitespace/casing is normalized. Returns "" for an empty or all-numeric label
 * (a bare code), so the caller falls back to the description.
 */
export function deriveNameFromLabel(raw: string | null | undefined): string {
  const norm = normalizeText(raw ?? "");
  if (!norm) return "";
  const tokens = norm.split(/\s+/).filter(Boolean);
  if (tokens.every((t) => /^\d+$/.test(t))) return ""; // pure code/number, not a name
  const name = tokens
    .slice(0, 8)
    .map((t) => (t === "&" ? "&" : t.charAt(0).toUpperCase() + t.slice(1)))
    .join(" ");
  return name.length > 60 ? name.slice(0, 60).trimEnd() : name;
}

/**
 * Stable dedup key for a derived name. Two descriptions that produce the same
 * name share a key and therefore share one ledger, across rows and across
 * imports. Must match how the posting side keys the account.
 */
export function deriveAccountKey(name: string): string {
  return normalizeText(name);
}
