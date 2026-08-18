/**
 * The system's single date standard: DD/MM/YYYY.
 *
 * Every human-facing date — ledgers, journals, invoices, statements, PDFs,
 * CSV/Excel exports, dashboards — goes through here. Nothing renders a raw
 * ISO string, a `toLocaleDateString()` (which follows the *viewer's* browser
 * locale, so the same ledger read differently on two machines), or a
 * date-fns pattern of its own.
 *
 * ISO `yyyy-MM-dd` remains the wire/storage format: database columns, query
 * params, `<input type="date">` values and `yyyyMMdd` filenames are untouched
 * by anything in this file.
 */

/**
 * Parses the shapes the app actually stores: a date-only `yyyy-MM-dd`, a full
 * timestamptz, or a `Date`.
 *
 * Date-only strings are pinned to *local* midnight by hand. `new Date("2026-08-18")`
 * is parsed as UTC midnight by spec, which renders as the 17th for any viewer
 * west of Greenwich — an entry posted on the 1st of a month would show in the
 * previous period.
 */
function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The standard: `18/08/2026`. Nullish or unparseable input renders as an em dash. */
export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** `18/08/2026 15:45` — the standard date plus a 24-hour clock. */
export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `18/08/2026 15:45:09` — for audit and error logs, where seconds matter. */
export function formatDateTimeSeconds(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${formatDateTime(d)}:${pad(d.getSeconds())}`;
}

/**
 * `18/08` — the standard truncated for dense chart tick labels, where a full
 * date would overlap its neighbours. Still day/month order.
 */
export function formatDateTick(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/** `15:45` on a 24-hour clock — the time half of the standard, used on its own. */
export function formatTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * `Tuesday, 18/08/2026` — for day headers and greetings, where the weekday is
 * the point. The weekday is context; the date inside it still follows the
 * standard rather than spelling out a month name.
 */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function formatDateWithWeekday(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${WEEKDAYS[d.getDay()]}, ${formatDate(d)}`;
}

/**
 * A month bucket, not a date: `Aug 2026`. Used for month pickers and monthly
 * chart series, which name a period rather than a day.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatMonth(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Documents (invoices, receipts, quotes, vouchers) once carried `18 Aug 2026`.
 * Kept as an alias so those call sites keep reading in document terms, but it
 * now resolves to the one system standard like everything else.
 */
export const formatInvoiceDate = formatDate;
