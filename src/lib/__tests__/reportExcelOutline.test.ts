import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";

/**
 * Guards the mechanism the collapsible statement depends on: SheetJS must
 * actually persist row outline levels into the .xlsx, and must place the
 * summary row above its detail. A grouping that only exists in our in-memory
 * grid would produce a flat file and nobody would notice until a reader opened
 * it, so this asserts on bytes written and read back.
 */
describe("xlsx row outlining", () => {
  it("round-trips outline levels and the summary-above-detail flag", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Revenue", 300],
      ["    4000 Sales", 200],
      ["    4100 Service Income", 100],
      ["GROSS PROFIT", 300],
    ]);
    ws["!rows"] = [{}, { level: 1 }, { level: 1 }, {}];
    ws["!outline"] = { above: true };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Face");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    expect(buf.length).toBeGreaterThan(0);

    const back = XLSX.read(buf, { type: "buffer", cellStyles: true });
    const rows = back.Sheets["Face"]["!rows"];
    expect(rows).toBeDefined();
    expect(rows![1]?.level).toBe(1);
    expect(rows![2]?.level).toBe(1);
    expect(rows![0]?.level ?? 0).toBe(0);
    expect(rows![3]?.level ?? 0).toBe(0);
  });
});
