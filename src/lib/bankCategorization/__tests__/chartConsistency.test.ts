import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { DEFAULT_CANONICAL_VARIANTS } from "../canonicalize";
import { SUSPENSE_CATEGORY } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Guards the three places the category taxonomy lives from drifting apart:
//   1. DEFAULT_CANONICAL_VARIANTS  (TS engine)
//   2. 20260721000002 seed          (global raw variant → canonical category)
//   3. 20260721000003 chart template (canonical category → ledger account)
// A category that resolves to no account would silently send every matching
// line to Suspense, so this must stay in lockstep.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolvePath(__dirname, "../../../../");
const SEED_SQL = readFileSync(
  resolvePath(ROOT, "supabase/migrations/20260721000002_bank_categorization_seed.sql"), "utf8");
const CHART_SQL = readFileSync(
  resolvePath(ROOT, "supabase/migrations/20260721000003_bank_import_chart_setup.sql"), "utf8");

/** Rows of the seed migration: (NULL, 'variant', 'category') */
function seedPairs(): [string, string][] {
  const out: [string, string][] = [];
  const re = /\(NULL,\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)'\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SEED_SQL)) !== null) {
    out.push([m[1].replace(/''/g, "'"), m[2].replace(/''/g, "'")]);
  }
  return out;
}

/** canonical_category values wired to an account in the chart template.
 * Row shape: (code, name, type, subtype, parent_code, canonical_category, side, sort) */
function templateCategories(): Set<string> {
  const out = new Set<string>();
  const re =
    /\('(\d{4})',\s*'(?:[^']|'')*',\s*'[^']*',\s*(?:'[^']*'|NULL),\s*(?:'[^']*'|NULL),\s*(?:'((?:[^']|'')*)'|NULL),/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CHART_SQL)) !== null) {
    if (m[2]) out.add(m[2].replace(/''/g, "'"));
  }
  return out;
}

describe("category taxonomy consistency", () => {
  it("the seed migration matches DEFAULT_CANONICAL_VARIANTS exactly", () => {
    const ts = [...DEFAULT_CANONICAL_VARIANTS].map(([v, c]) => `${v}=>${c}`).sort();
    const sql = seedPairs().map(([v, c]) => `${v}=>${c}`).sort();
    expect(sql).toEqual(ts);
  });

  it("every canonical category has a destination account in the chart template", () => {
    const template = templateCategories();
    const reversals = new Set(
      [...CHART_SQL.matchAll(/SET reversal_category = '([a-z_]+)'/g)].map((m) => m[1]));
    const missing = [...new Set(DEFAULT_CANONICAL_VARIANTS.map(([, c]) => c))]
      .filter((c) => c !== SUSPENSE_CATEGORY)          // routed to directional Unrecognized
      .filter((c) => !template.has(c) && !reversals.has(c));
    expect(missing).toEqual([]);
  });

  it("every _reversal category is wired to its base account on the opposite side", () => {
    // Reversal rows ("Salary Reverse") are routine in the source workbook; if
    // they are not mapped, every one of them lands in Suspense by hand.
    const reversals = new Set(
      [...CHART_SQL.matchAll(/SET reversal_category = '([a-z_]+)'/g)].map((m) => m[1]));
    const declared = [...new Set(DEFAULT_CANONICAL_VARIANTS.map(([, c]) => c))]
      .filter((c) => c.endsWith("_reversal"));
    expect(declared.length).toBeGreaterThan(0);
    for (const c of declared) expect(reversals.has(c)).toBe(true);
    // The setup RPC must flip the side rather than reusing the base side.
    expect(CHART_SQL).toMatch(/WHEN 'debit' THEN 'credit'/);
    expect(CHART_SQL).toMatch(/WHEN 'credit' THEN 'debit'/);
  });

  it("the chart template defines both directional Unrecognized accounts", () => {
    // 4010 holds unresolved money IN, 6010 unresolved money OUT. The setup RPC
    // wires these two codes into account_settings — keep them in step.
    expect(CHART_SQL).toMatch(/'4010',\s*'Unrecognized Deposits'/);
    expect(CHART_SQL).toMatch(/'6010',\s*'Unrecognized Payments'/);
    expect(CHART_SQL).toMatch(/account_code = '4010' THEN v_deposit_id/);
    expect(CHART_SQL).toMatch(/account_code = '6010' THEN v_payment_id/);
  });

  it("every non-header template account declares a parent that exists", () => {
    const rows = [...CHART_SQL.matchAll(
      /\('(\d{4})',\s*'(?:[^']|'')*',\s*'[^']*',\s*(?:'[^']*'|NULL),\s*(?:'(\d{4})'|NULL),/g)];
    const codes = new Set(rows.map((m) => m[1]));
    const orphans = rows.filter((m) => m[2] && !codes.has(m[2])).map((m) => m[1]);
    expect(orphans).toEqual([]);
    // Fixed-asset detail accounts MUST have a parent (fn_require_subledger_parent).
    const ppe = rows.filter((m) => m[1].startsWith("16") && m[1] !== "1600");
    expect(ppe.length).toBeGreaterThan(0);
    expect(ppe.every((m) => m[2] === "1600")).toBe(true);
  });

  it("template account codes are unique", () => {
    const codes = [...CHART_SQL.matchAll(/^\s*\('(\d{4})',/gm)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(50);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every template account uses a canonical Trish Books account_type", () => {
    const valid = new Set([
      "Asset", "Liability", "Equity", "Income",
      "Cost of Goods Sold", "Expense", "Other Income", "Other Expense",
    ]);
    const types = [...CHART_SQL.matchAll(/^\s*\('\d{4}',\s*'(?:[^']|'')*',\s*'([^']+)',/gm)].map((m) => m[1]);
    expect(types.length).toBeGreaterThan(50);
    for (const t of types) expect(valid.has(t)).toBe(true);
  });
});
