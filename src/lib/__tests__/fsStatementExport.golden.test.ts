import { describe, it, expect } from "vitest";
import { buildSociCsvRows, SOCI_CSV_HEADERS } from "../fsStatementExport";
import type { FsStatementLine } from "@/hooks/useFinancialStatements";

function line(partial: Partial<FsStatementLine> & Pick<FsStatementLine, "line_id" | "line_code" | "label">): FsStatementLine {
  return {
    note_ref: null,
    line_type: "detail",
    emphasis: "normal",
    show_margin: false,
    sort_order: 0,
    current_value: null,
    compare_value: null,
    current_margin: null,
    compare_margin: null,
    account_count: 0,
    ...partial,
  };
}

// A compact fixture covering every line_type the golden CSV needs to render
// correctly: detail (blanks zero), computed subtotal with a margin (shows
// 0.00 even when genuinely zero), and per_share (blank when unresolved).
const FIXTURE_LINES: FsStatementLine[] = [
  line({ line_id: "l1", line_code: "REVENUE", label: "Revenue", note_ref: "01", line_type: "detail", current_value: 2150487725.11, compare_value: 1811248196.68 }),
  line({ line_id: "l2", line_code: "COS", label: "Cost of Sales", note_ref: "02", line_type: "detail", current_value: -1629561652.68, compare_value: -1392469295.43 }),
  line({ line_id: "l3", line_code: "GROSS_PROFIT", label: "GROSS PROFIT", line_type: "computed", emphasis: "bold_rule", show_margin: true, current_value: 520926072.43, compare_value: 418778901.25, current_margin: 24.22, compare_margin: 23.12 }),
  line({ line_id: "l4", line_code: "UNMAPPED_EXP", label: "Unmapped Expense Line", line_type: "detail", current_value: 0, compare_value: 0 }), // zero (unmapped) -> blank on CSV
  line({ line_id: "l5", line_code: "EPS", label: "Basic Earnings / (Loss) Per Ordinary Share", note_ref: "08", line_type: "per_share", current_value: null, compare_value: null }), // param missing -> blank
];

describe("SOCI CSV golden file", () => {
  it("has the expected 6-column headers", () => {
    expect(SOCI_CSV_HEADERS).toEqual(["Label", "Note", "Current", "Comparative", "Current Margin %", "Comparative Margin %"]);
  });

  it("matches the golden row-by-row layout, including footer warnings and ack note", () => {
    const rows = buildSociCsvRows(
      FIXTURE_LINES,
      "SOCI/2025-04-01/2026-03-31/deadbeef · Profit for the year 134830024.21",
      "Exported with 1 unresolved coverage error(s), acknowledged by Treshane on Aug 3, 2026",
      ["[ERROR] UNMAPPED_ACCOUNT: Account has period movement but is not mapped to any line of this statement"]
    );

    expect(rows).toEqual([
      ["Revenue", "01", "2150487725.11", "1811248196.68", "", ""],
      ["Cost of Sales", "02", "-1629561652.68", "-1392469295.43", "", ""],
      ["GROSS PROFIT", "", "520926072.43", "418778901.25", "24.22", "23.12"],
      ["Unmapped Expense Line", "", "", "", "", ""], // detail line, zero -> blank
      ["Basic Earnings / (Loss) Per Ordinary Share", "08", "", "", "", ""], // per_share, null -> blank
      [],
      ["SOCI/2025-04-01/2026-03-31/deadbeef · Profit for the year 134830024.21"],
      ["Exported with 1 unresolved coverage error(s), acknowledged by Treshane on Aug 3, 2026"],
      ["[ERROR] UNMAPPED_ACCOUNT: Account has period movement but is not mapped to any line of this statement"],
    ]);
  });

  it("omits the ack-note row entirely when there was nothing to acknowledge", () => {
    const rows = buildSociCsvRows(FIXTURE_LINES.slice(0, 1), "fp", undefined, []);
    expect(rows.filter((r) => r.length === 1)).toEqual([["fp"]]);
  });

  it("spacer lines never reach the CSV", () => {
    const withSpacer = [...FIXTURE_LINES, line({ line_id: "l6", line_code: "SPACER", label: "", line_type: "spacer" })];
    const rows = buildSociCsvRows(withSpacer, "fp", undefined, []);
    expect(rows.some((r) => r.length === 6 && r[0] === "")).toBe(false);
  });
});
