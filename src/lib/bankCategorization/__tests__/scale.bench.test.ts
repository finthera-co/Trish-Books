import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseSheetMatrix } from "../parser";
import { resolveBatch } from "../index";
import { validateBatch } from "../validate";
import { makeCtx, ACC, rule } from "./helpers";

/**
 * Scale characterisation for the real workbook shape: 11 monthly sheets,
 * ~33,300 rows total. Asserts the pure engine stays well inside an edge
 * function's budget; the network/insert cost is measured separately.
 */
const VARIANTS = ["Salary","Harvset","Building Rent","Bank Fee","ORC & Travel Allowance",
  "Welfare","Petty Cash","Plantation","Commission","Mystery Cat",""];

function buildWorkbook(rowsPerSheet: number, sheets: number) {
  const yr = (s: number) => 2015 + s;
  const wb = XLSX.utils.book_new();
  for (let s = 0; s < sheets; s++) {
    const rows: unknown[][] = [["Payment Analysis"],
      ["Date","Name","Description","Account Type","Debit","Credit","Balance"]];
    rows.push([`${yr(s)}-05-01`,"","b/f","","","","100000"]);
    for (let i = 0; i < rowsPerSheet; i++) {
      const v = VARIANTS[i % VARIANTS.length];
      const inflow = i % 9 === 0;
      rows.push([`${yr(s)}-05-02`, `PAYEE_${i % 500}`, inflow ? "cash deposit" : `payment ${i % 300}`,
        v, inflow ? "" : String(100 + (i % 900) + 0.05), inflow ? String(5000 + i) : "", ""]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `May ${2015 + s}`);
  }
  return wb;
}

describe("scale: full workbook shape", () => {
  it("parses + resolves ~33k rows well inside an edge-function budget", () => {
    const SHEETS = 11, PER = 3027;           // 33,297 data rows
    const wb = buildWorkbook(PER, SHEETS);

    const tSer = performance.now();
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const serialiseMs = performance.now() - tSer;

    const tRead = performance.now();
    const re = XLSX.read(buf, { type: "buffer", cellDates: true });
    const readMs = performance.now() - tRead;

    const ctx = makeCtx({
      rules: [rule({ matchValue: "cash deposit", accountId: ACC.capital, expectedSide: "credit", priority: 10 })],
    });

    const tAll = performance.now();
    const all = [];
    for (let s = 0; s < SHEETS; s++) {
      const name = `May ${2015 + s}`;
      const m = XLSX.utils.sheet_to_json(re.Sheets[name], { header: 1, raw: true, defval: null }) as unknown[][];
      all.push(...parseSheetMatrix(m, name, { month: 5, year: 2015 + s }).lines);
    }
    const parseMs = performance.now() - tAll;

    const tRes = performance.now();
    const resolved = resolveBatch(all, ctx);
    const resolveMs = performance.now() - tRes;

    const tVal = performance.now();
    const batch = validateBatch(all);
    const validateMs = performance.now() - tVal;

    const tally = { resolved: 0, derive: 0, suspense: 0, blocked: 0, excluded: 0 };
    for (const r of resolved) r.resolution === null ? tally.excluded++ : tally[r.resolution.kind]++;

    // eslint-disable-next-line no-console
    console.log(`\n  rows=${all.length}  xlsx=${(buf.length/1048576).toFixed(1)}MB` +
      `\n  write=${serialiseMs.toFixed(0)}ms read=${readMs.toFixed(0)}ms parse=${parseMs.toFixed(0)}ms` +
      ` resolve=${resolveMs.toFixed(0)}ms validate=${validateMs.toFixed(0)}ms` +
      `\n  engine total=${(readMs+parseMs+resolveMs+validateMs).toFixed(0)}ms  ${JSON.stringify(tally)}` +
      `\n  heap=${(process.memoryUsage().heapUsed/1048576).toFixed(0)}MB\n`);

    expect(all.length).toBe(SHEETS * (PER + 1));
    expect(tally.blocked).toBe(0);
    expect(batch.rowCount).toBe(SHEETS * PER);
    // Pure engine must be a small fraction of the ~150s edge wall clock.
    expect(readMs + parseMs + resolveMs + validateMs).toBeLessThan(30_000);
  }, 180_000);
});
