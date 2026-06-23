// IRD Gazette 2481/22 mandates MM/DD/YYYY for Date of Invoice and Date of
// Supply on the statutory VAT tax invoice. Centralised here so the format is
// changeable in one place if IRD later clarifies.
export function formatGazetteDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d + (d.length === 10 ? "T00:00:00" : "")) : d;
  if (isNaN(dt.getTime())) return "";
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}
