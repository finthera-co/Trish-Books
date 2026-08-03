import type { FsStatementLine } from "@/hooks/useFinancialStatements";

// Negatives in parentheses, no minus sign, no currency symbol — a statutory
// face, not a dashboard. Zero renders blank on detail lines (unmapped/no
// activity looks the same as genuinely zero), but a computed subtotal that's
// genuinely zero still shows "0.00" — it's a real answer, not an absence.
export function fmtStatement(n: number | null | undefined, blankZero: boolean): string {
  if (n == null) return "";
  if (blankZero && Math.abs(n) < 0.005) return "";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < -0.005 ? `(${s})` : s;
}

// EPS: 2dp, no thousands separator (matches the reference: 793.58, not 793.58 with commas).
export function fmtEps(n: number | null | undefined): string {
  if (n == null) return "";
  const s = Math.abs(n).toFixed(2);
  return n < -0.005 ? `(${s})` : s;
}

// Margin is already a percentage computed server-side; just fix to 2dp.
export function fmtMargin(n: number | null | undefined): string {
  if (n == null) return "";
  return n.toFixed(2);
}

export function rowClasses(emphasis: FsStatementLine["emphasis"]): string {
  switch (emphasis) {
    case "bold_rule":
      return "font-bold border-t border-foreground/40";
    case "total_rule":
      return "font-bold border-t-2 border-double border-foreground/60";
    case "bold":
      return "font-bold";
    default:
      return "";
  }
}
