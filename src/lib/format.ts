const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * dd MMM yyyy, with a fixed month table instead of Intl.DateTimeFormat.
 * ICU 72+ returns "Sept" (not "Sep") for September under { month: "short" }
 * in en-GB/en-US, while every other month stays three letters — so dates on
 * the same document drift in width depending on the browser/Node ICU version.
 */
export function formatInvoiceDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return typeof d === "string" ? d : "—";
  const dd = String(date.getDate()).padStart(2, "0");
  const mmm = MONTHS[date.getMonth()];
  const yyyy = date.getFullYear();
  return `${dd} ${mmm} ${yyyy}`;
}
