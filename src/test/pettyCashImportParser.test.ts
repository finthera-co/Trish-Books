import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  parseImportAmount,
  parsePettyCashWorkbook,
  type ParseResult,
} from "@/lib/pettyCashImportParser";

const HEADERS = ["Date", "Voucher No.", "Name", "Description", "Account Type", "Debit", "Credit"];

// jsdom's Blob predates Blob.arrayBuffer(); browsers have had it for years.
// Patch it in rather than weakening the parser to accommodate the test env.
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

/** Builds a real .xlsx in memory and hands it back as a File. */
function workbookFile(rows: unknown[][], name = "petty.xlsx", sheets?: Record<string, unknown[][]>): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  for (const [sheetName, aoa] of Object.entries(sheets ?? {})) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const row = (date: unknown, vno: string, desc: string, acct: string, dr: string, cr = "") =>
  [date, vno, "Nimal", desc, acct, dr, cr];

async function parse(rows: unknown[][], opts?: Parameters<typeof parsePettyCashWorkbook>[1]): Promise<ParseResult> {
  return parsePettyCashWorkbook(workbookFile([HEADERS, ...rows]), opts);
}

describe("parseImportAmount", () => {
  it("reads the currency and separator noise a Sri Lankan sheet actually carries", () => {
    expect(parseImportAmount("Rs. 1,250.00")).toBe(1250);
    expect(parseImportAmount("LKR 900")).toBe(900);
    expect(parseImportAmount("රු 42.50")).toBe(42.5);
  });

  it("returns the accounting negative rather than silently absolute-valuing it", () => {
    // The resolver blocks this with AMOUNT_NEGATIVE; swallowing the sign here
    // would post money in the wrong direction.
    expect(parseImportAmount("(500.00)")).toBe(-500);
    expect(parseImportAmount("-500")).toBe(-500);
  });

  it("treats dash and blank placeholders as a real zero", () => {
    expect(parseImportAmount("-")).toBe(0);
    expect(parseImportAmount("–")).toBe(0);
    expect(parseImportAmount("")).toBe(0);
    expect(parseImportAmount("n/a")).toBe(0);
  });

  it("returns null for anything else, so the resolver can block it", () => {
    expect(parseImportAmount("abc")).toBeNull();
    expect(parseImportAmount("1.2.3")).toBeNull();
  });
});

describe("parsePettyCashWorkbook", () => {
  it("reads a clean 20-row DD/MM file", async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row(`${String((i % 28) + 1).padStart(2, "0")}/03/2026`, `PV-${i}`, "tea", "Electricity", "100"),
    );
    // 13/03 through 28/03 prove day-first.
    const res = await parse(rows);
    expect(res.rows).toHaveLength(20);
    expect(res.dateVerdict).toEqual({ kind: "resolved", format: "DD/MM/YYYY" });
    expect(res.rows[0].parsedDate).toBe("2026-03-01");
  });

  it("refuses a file that mixes both orders instead of picking one", async () => {
    const res = await parse([
      row("25/03/2026", "PV-1", "tea", "Electricity", "100"),
      row("03/25/2026", "PV-2", "sugar", "Electricity", "100"),
    ]);
    expect(res.dateVerdict.kind).toBe("conflicting");
    // No row may carry a date the file cannot justify.
    expect(res.rows.every((r) => r.parsedDate === null)).toBe(true);
  });

  it("asks the user when every component is <= 12", async () => {
    const res = await parse([
      row("05/03/2026", "PV-1", "tea", "Electricity", "100"),
      row("06/04/2026", "PV-2", "sugar", "Electricity", "100"),
    ]);
    expect(res.dateVerdict.kind).toBe("ambiguous");
    if (res.dateVerdict.kind === "ambiguous") {
      expect(res.dateVerdict.sample).toEqual(["05/03/2026", "06/04/2026"]);
    }
  });

  it("honours an explicit choice on an ambiguous file", async () => {
    const rows = [row("05/03/2026", "PV-1", "tea", "Electricity", "100")];
    expect((await parse(rows, { dateFormat: "DD/MM/YYYY" })).rows[0].parsedDate).toBe("2026-03-05");
    expect((await parse(rows, { dateFormat: "MM/DD/YYYY" })).rows[0].parsedDate).toBe("2026-05-03");
  });

  it("reads Excel serial dates with no off-by-one", async () => {
    const res = await parse([
      row(new Date(Date.UTC(2026, 2, 25)), "PV-1", "tea", "Electricity", "100"),
    ]);
    expect(res.dateVerdict).toEqual({ kind: "resolved", format: "EXCEL_SERIAL" });
    expect(res.rows[0].parsedDate).toBe("2026-03-25");
  });

  it("reads ISO dates", async () => {
    const res = await parse([row("2026-03-25", "PV-1", "tea", "Electricity", "100")]);
    expect(res.dateVerdict).toEqual({ kind: "resolved", format: "YYYY-MM-DD" });
    expect(res.rows[0].parsedDate).toBe("2026-03-25");
  });

  it("maps header synonyms", async () => {
    const res = await parsePettyCashWorkbook(
      workbookFile([
        ["Txn Date", "Chq No.", "Payee", "Narration", "Head", "Dr", "Cr"],
        ["25/03/2026", "PV-9", "Nimal", "tea", "Electricity", "100", ""],
      ]),
    );
    expect(res.missingColumns).toEqual([]);
    expect(Object.keys(res.headerMap).sort()).toEqual(
      ["account_type", "credit", "date", "debit", "description", "name", "voucher_no"].sort(),
    );
    expect(res.rows[0].rawVoucherNo).toBe("PV-9");
    expect(res.rows[0].rawDescription).toBe("tea");
  });

  it("reports missing columns rather than staging a half-read file", async () => {
    const res = await parsePettyCashWorkbook(
      workbookFile([
        ["Date", "Name", "Description"],
        ["25/03/2026", "Nimal", "tea"],
      ]),
    );
    expect(res.missingColumns).toEqual(["debit", "credit"]);
    expect(res.rows).toEqual([]);
  });

  it("keeps a row carrying both Debit and Credit — the resolver blocks it, the parser must not drop it", async () => {
    const res = await parse([row("25/03/2026", "PV-1", "both", "Electricity", "100", "50")]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].debit).toBe(100);
    expect(res.rows[0].credit).toBe(50);
  });

  it("skips blank rows but surfaces a total row", async () => {
    const res = await parse([
      row("25/03/2026", "PV-1", "tea", "Electricity", "100"),
      ["", "", "", "", "", "", ""],
      ["", "", "", "Total", "", "100", ""],
      ["", "", "", "", "", "", ""],
    ]);
    // The total row has no account and will block on ACCOUNT_* at staging,
    // which is what makes it visible to the user.
    expect(res.rows).toHaveLength(2);
    expect(res.rows[1].rawDescription).toBe("Total");
    expect(res.rows[1].rawAccountType).toBe("");
  });

  it("finds the header under a title block", async () => {
    const res = await parsePettyCashWorkbook(
      workbookFile([
        ["ACME (Pvt) Ltd — Petty Cash Book", "", "", "", "", "", ""],
        ["", "", "", "", "", "", ""],
        HEADERS,
        ["25/03/2026", "PV-1", "Nimal", "tea", "Electricity", "100", ""],
      ]),
    );
    expect(res.missingColumns).toEqual([]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].rowNo).toBe(4);
  });

  it("hashes the same bytes to the same digest, and lists every sheet", async () => {
    const rows = [HEADERS, row("25/03/2026", "PV-1", "tea", "Electricity", "100")];
    const a = await parsePettyCashWorkbook(workbookFile(rows, "a.xlsx", { March: rows }));
    const b = await parsePettyCashWorkbook(workbookFile(rows, "a.xlsx", { March: rows }));
    expect(a.fileHash).toBe(b.fileHash);
    expect(a.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sheetNames).toEqual(["Sheet1", "March"]);
    expect(a.sheetName).toBe("Sheet1");
  });

  it("parses the sheet the caller asked for", async () => {
    const other = [HEADERS, row("26/03/2026", "PV-77", "fuel", "Electricity", "999")];
    const res = await parsePettyCashWorkbook(
      workbookFile([HEADERS, row("25/03/2026", "PV-1", "tea", "Electricity", "100")], "m.xlsx", { March: other }),
      { sheetName: "March" },
    );
    expect(res.sheetName).toBe("March");
    expect(res.rows[0].rawVoucherNo).toBe("PV-77");
  });
});
