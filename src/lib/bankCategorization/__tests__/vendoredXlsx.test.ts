import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// The edge function parses the uploaded workbook with a VENDORED copy of
// SheetJS (Supabase's bundler refuses cdn.sheetjs.com, and npm/esm.sh only
// carry 0.18.5). That copy must stay pinned to the same build the browser
// preview uses — otherwise the sheet/period counts a user confirms on screen
// could differ from what the server actually posts.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolvePath(__dirname, "../../../../");
const VENDORED = resolvePath(ROOT, "supabase/functions/_shared/vendor/xlsx.mjs");
const EDGE_FN = resolvePath(ROOT, "supabase/functions/import-bank-statement/index.ts");

function vendoredVersion(): string | null {
  // XLSX stamps its own version first in the bundle.
  const m = readFileSync(VENDORED, "utf8").match(/version *= *'(\d+\.\d+\.\d+)'/);
  return m ? m[1] : null;
}

describe("vendored SheetJS", () => {
  it("exists and is a real bundle, not a stub", () => {
    expect(existsSync(VENDORED)).toBe(true);
    expect(readFileSync(VENDORED).byteLength).toBeGreaterThan(100_000);
  });

  it("matches the xlsx version pinned in package.json", () => {
    const pkg = JSON.parse(readFileSync(resolvePath(ROOT, "package.json"), "utf8"));
    const spec: string = pkg.dependencies.xlsx;
    const pinned = spec.match(/xlsx-(\d+\.\d+\.\d+)/)?.[1] ?? spec.replace(/^[^\d]*/, "");
    expect(vendoredVersion()).toBe(pinned);
  });

  it("matches the installed package when node_modules is present", () => {
    const installed = resolvePath(ROOT, "node_modules/xlsx/package.json");
    if (!existsSync(installed)) return; // fresh clone / CI without install
    const v = JSON.parse(readFileSync(installed, "utf8")).version;
    expect(vendoredVersion()).toBe(v);
  });

  it("the edge function imports the vendored copy, never a CDN", () => {
    const src = readFileSync(EDGE_FN, "utf8");
    expect(src).toMatch(/import \* as XLSX from "\.\.\/_shared\/vendor\/xlsx\.mjs"/);
    // Importing from cdn.sheetjs.com fails the deploy outright ("Cannot import
    // from cdn.sheetjs.com:443"), so guard the import statements themselves —
    // prose mentioning the CDN (like the note above the import) is fine.
    const cdnImports = src
      .split("\n")
      .filter((l) => /^\s*(import|export)\b/.test(l) && /cdn\.sheetjs\.com/.test(l));
    expect(cdnImports).toEqual([]);
  });

  it("parses the workbook once, groups by month, posts each month as its own batch", () => {
    // The whole-year workbook is downloaded and parsed ONCE, grouped by each
    // row's own month, and every month posts as its own atomic batch — so a
    // single 50k transaction never posts and the file is never re-parsed 12×.
    const src = readFileSync(EDGE_FN, "utf8");
    // exactly one XLSX.read (single parse), inside a GC-scoping block
    expect(src.match(/XLSX\.read\(/g)?.length).toBe(1);
    expect(src).toMatch(/const groups = new Map<string, ParsedLine\[\]>\(\)/);
    expect(src).toMatch(/async function postMonth\(/);
    expect(src).toMatch(/lines\.length > MAX_ROWS_PER_MONTH/);
    expect(src).toMatch(/for \(let i = 0; i < monthKeys\.length; i\+\+\)/);
  });
});
