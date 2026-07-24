/**
 * Canonicalization: raw `Account Type` variants → canonical category.
 *
 * EXACT match on normalized text only — no fuzzy matching here, ever.
 * Coverage grows exclusively through human-confirmed mappings added during
 * Suspense Clearing ("teach the engine"). An unrecognized variant is never an
 * error and never a guess: it resolves to Suspense downstream.
 */

import { normalizeText } from "./normalize.ts";
import type { CanonicalMapEntry } from "./types.ts";

/**
 * Seed variants verified against the real Sampath payment-analysis workbook.
 * Stored pre-normalized. These seed the global (tenant_id IS NULL) rows of
 * bank_category_canonical_map; tenants extend them via Suspense Clearing.
 *
 * Each canonical category resolves to a real ledger account through
 * bank_category_account_map — see the chart template in migration
 * 20260721000003, which is the authoritative category → account wiring.
 * Category names here MUST match `canonical_category` in that template.
 */
export const DEFAULT_CANONICAL_VARIANTS: ReadonlyArray<readonly [string, string]> = [
  // [raw variant (normalized), canonical category]  → destination account
  ["harvest", "harvest"],                             // Harvest Payments
  ["harvset", "harvest"],
  ["harvest reverse", "harvest_reversal"],
  ["salary", "salary"],                               // Salaries
  ["basic salary", "salary"],
  ["salary reverse", "salary_reversal"],
  ["orc/travelling allowance", "orc_travelling_allowance"], // Travelling Expenses
  ["orc & travel allowance", "orc_travelling_allowance"],
  ["orc & travelling allowance", "orc_travelling_allowance"],
  ["orc & travelling allowane", "orc_travelling_allowance"],
  ["orc/travel allowance", "orc_travelling_allowance"],
  ["orc", "orc_travelling_allowance"],
  ["orc payment", "orc_travelling_allowance"],
  ["travel allowance", "orc_travelling_allowance"],
  ["travel", "orc_travelling_allowance"],
  ["fuel allowance", "fuel"],                         // Fuel (own account)
  ["bank fee", "bank_charges"],                       // Bank Charges
  ["bank fees", "bank_charges"],
  ["sampath", "bank_charges"],
  ["legal & compliance cost", "legal_compliance"],    // Legal Fees
  ["lawyer payment", "legal_compliance"],
  ["lawyer payments", "legal_compliance"],
  ["building rent", "building_rent"],                 // Building Rent
  ["rent", "building_rent"],
  ["car rent", "vehicle_rent"],                       // Vehicle Rent
  ["vehicle rent", "vehicle_rent"],
  ["welfare", "welfare"],                             // Staff Welfare
  ["welfare expense", "welfare"],
  ["delectaa", "delecta"],                            // Delecta Launch Expenses
  ["deelectaa", "delecta"],
  ["delecta bottle", "delecta"],
  ["other admin expenses", "admin_other"],            // Sundry Expenses
  ["other admin expense", "admin_other"],
  ["fixed allowance", "fixed_allowance"],             // Allowances
  ["fixed", "fixed_allowance"],
  ["commission", "commission"],                       // Commissions
  ["green crest", "green_crest"],                     // Green Crest
  ["petty cash", "petty_cash"],                       // Petty cash Expenses
  ["plantation", "plantation"],                       // Plantation
  ["plantation operations", "plantation"],
  ["trainning & devolopment", "training_development"], // Training Expenses
  ["suspense", "suspense"],                           // → directional Unrecognized
];

/** Build a lookup Map from DB rows (or the defaults, in tests). */
export function buildCanonicalMap(entries: CanonicalMapEntry[]): Map<string, CanonicalMapEntry> {
  const map = new Map<string, CanonicalMapEntry>();
  for (const e of entries) {
    map.set(normalizeText(e.rawVariant), e);
  }
  return map;
}

export function defaultCanonicalEntries(): CanonicalMapEntry[] {
  return DEFAULT_CANONICAL_VARIANTS.map(([raw, canonical], i) => ({
    id: `default-${i}`,
    rawVariant: raw,
    canonicalCategory: canonical,
  }));
}

/**
 * Resolve a raw account_type to its canonical category.
 * Returns null when the (normalized) variant has no mapping — the caller
 * routes the line to Suspense with reason `unknown_category_variant`.
 */
export function canonicalize(
  rawAccountType: string | null | undefined,
  canonicalMap: Map<string, CanonicalMapEntry>
): CanonicalMapEntry | null {
  const key = normalizeText(rawAccountType);
  if (!key) return null;
  return canonicalMap.get(key) ?? null;
}
