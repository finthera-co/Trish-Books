import { formatCurrency } from "@/lib/currency";
import { amountInWords } from "@/lib/numberToWords";
import { formatInvoiceDate as formatDocDate } from "@/lib/format";

export interface ReceiptModel {
  receiptNumber: string;
  receiptDate: string;
  receivedFrom: string;
  customerAddress?: string | null;
  invoiceNumber?: string | null;
  amount: number;
  paymentMethod?: string | null;
  reference?: string | null;
  /**
   * The invoice's own total. Never derive this from amount + balanceDue —
   * balanceDue already excludes this payment, so the two would double-count.
   * Null for a receipt not raised against an invoice.
   */
  invoiceTotal?: number | null;
  /** What remains owing on the invoice AFTER this payment. Null = not invoice-linked. */
  balanceDue?: number | null;
  notes?: string | null;
  currency?: string;
}

export const methodLabel = (m?: string | null) =>
  m ? m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";

/** Settlement state of the invoice this receipt is against. */
export const receiptStatusLabel = (balanceDue?: number | null) =>
  balanceDue == null ? null : balanceDue <= 0.005 ? "PAID IN FULL" : "PART PAYMENT";

/**
 * What is still owed once this receipt's payment is applied.
 *
 * `settledBefore` is everything the invoice had already cleared EXCLUDING the
 * payment being receipted. Passing a figure that still contains this payment —
 * or deriving the invoice total as amount + balance — double-counts the money,
 * which is exactly how the total came out twice its real value before.
 */
export function balanceAfterReceipt(
  invoiceTotal: number | null | undefined,
  settledBefore: number,
  amount: number,
): number | null {
  if (invoiceTotal == null) return null; // not raised against an invoice
  const remaining = Number(invoiceTotal) - (Number(settledBefore) || 0) - (Number(amount) || 0);
  return Math.max(0, Math.round(remaining * 100) / 100);
}

/**
 * On-screen payment receipt — the live preview of the downloadable PDF, and
 * what the Print button renders. Kept structurally identical to buildReceiptPdf
 * (header lockup, hero amount band, words line, detail table, settlement
 * ladder) so the preview never promises a layout the file doesn't deliver.
 */
export default function ReceiptDocument({ model, company }: { model: ReceiptModel; company: any }) {
  const cur = model.currency || "LKR";
  const wordsUnit = cur === "LKR" ? "Rupees" : cur;
  const status = receiptStatusLabel(model.balanceDue);
  const paidInFull = status === "PAID IN FULL";
  const received = Number(model.amount) || 0;
  const balance = Number(model.balanceDue) || 0;
  const invoiceTotal = model.invoiceTotal == null ? null : Number(model.invoiceTotal) || 0;
  const settledEarlier =
    invoiceTotal == null ? 0 : Math.round((invoiceTotal - received - balance) * 100) / 100;

  const meta: [string, string][] = [["Receipt Date", model.receiptDate ? formatDocDate(model.receiptDate) : "—"]];
  if (model.paymentMethod) meta.push(["Payment Method", methodLabel(model.paymentMethod)]);
  if (model.reference) meta.push(["Reference", model.reference]);
  if (model.invoiceNumber) meta.push(["Against Invoice", model.invoiceNumber]);

  return (
    <div id="receipt-doc" className="bg-white text-neutral-900 w-full text-sm">
      {/* Top accent bar — the one full-bleed use of the accent colour */}
      <div className="h-[6px] bg-[#0b3b60]" />

      <div className="p-8">
        {/* Header: logo + company (left) · doc type + number + status (right) */}
        <div className="flex items-start justify-between gap-6 pb-5 border-b border-neutral-200">
          <div className="flex items-start gap-4">
            {company?.logo_url
              ? <img src={company.logo_url} alt="" className="h-20 max-w-[150px] object-contain" />
              : <div className="h-20 w-20 rounded-lg bg-neutral-100 flex items-center justify-center text-neutral-400 text-xs">Logo</div>}
            <div>
              <h2 className="text-lg font-bold">{company?.company_name || "Your Company"}</h2>
              {company?.address && <p className="text-neutral-500 whitespace-pre-line text-xs">{company.address}</p>}
              {company?.phone && <p className="text-neutral-500 text-xs">{company.phone}</p>}
              {company?.tax_id && <p className="text-neutral-500 text-xs">TIN: {company.tax_id}</p>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <h1 className="text-xl font-bold tracking-[0.06em] text-[#0b3b60]">PAYMENT RECEIPT</h1>
            <p className="text-neutral-900 font-mono font-semibold mt-1.5">{model.receiptNumber || "—"}</p>
            {status && (
              <span className={`mt-2 inline-block rounded border px-2 py-0.5 text-[10px] font-bold tracking-wider ${
                paidInFull ? "border-green-700 text-green-700" : "border-[#0b3b60] text-[#0b3b60]"}`}>
                {status}
              </span>
            )}
          </div>
        </div>

        {/* Received from (left) + receipt meta grid (right) */}
        <div className="grid grid-cols-2 gap-6 pt-6 pb-5 items-start">
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] text-neutral-400 mb-1.5">Received from</p>
            <p className="text-base font-bold">{model.receivedFrom || "—"}</p>
            {model.customerAddress && <p className="text-neutral-500 whitespace-pre-line text-xs mt-0.5">{model.customerAddress}</p>}
          </div>
          <div className="space-y-1.5">
            {meta.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <span className="text-neutral-500">{label}</span>
                <span className="font-mono font-semibold tabular-nums text-right">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* The hero band: what this document exists to prove */}
        <div className="flex items-center justify-between gap-4 rounded-lg bg-[#0b3b60] text-white px-6 py-4">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em]">Amount received</span>
          <span className="text-2xl font-mono font-bold tabular-nums">{formatCurrency(received, cur)}</span>
        </div>

        {/* Amount in words — the line that makes a receipt hard to alter */}
        <div className="mt-3 rounded-md bg-neutral-50 border border-neutral-200 px-4 py-2 text-xs">
          <span className="text-neutral-400">In words: </span>
          <span className="text-neutral-800 italic">{amountInWords(received, wordsUnit)}</span>
        </div>

        {/* Payment detail table */}
        <table className="w-full mt-7">
          <thead>
            <tr className="bg-[#0b3b60] text-white text-left text-[11px] tracking-wide">
              <th className="py-2.5 px-3 rounded-l font-bold">AGAINST INVOICE</th>
              <th className="py-2.5 px-3 font-bold">PAYMENT METHOD</th>
              <th className="py-2.5 px-3 font-bold">REFERENCE</th>
              <th className="py-2.5 px-3 text-right rounded-r font-bold">AMOUNT ({cur})</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-[#f7f9fb]">
              <td className="py-3 px-3 font-mono">{model.invoiceNumber || "—"}</td>
              <td className="py-3 px-3">{methodLabel(model.paymentMethod)}</td>
              <td className="py-3 px-3 text-neutral-500">{model.reference || "—"}</td>
              <td className="py-3 px-3 text-right font-mono font-bold tabular-nums">
                {formatCurrency(received, cur).replace(`${cur} `, "")}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Notes (left) + settlement ladder (right) */}
        <div className="grid grid-cols-2 gap-8 pt-7 items-start">
          <div>
            {model.notes && (
              <>
                <p className="text-[11px] uppercase tracking-[0.08em] text-neutral-400 mb-1">Notes</p>
                <p className="text-xs text-neutral-600 whitespace-pre-line">{model.notes}</p>
              </>
            )}
          </div>
          {model.balanceDue != null && (
            <div className="border-l-2 border-[#0b3b60] pl-5">
              <div className="space-y-2">
                {invoiceTotal != null && (
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Invoice Total</span>
                    <span className="font-mono tabular-nums">{formatCurrency(invoiceTotal, cur)}</span>
                  </div>
                )}
                {settledEarlier > 0.005 && (
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Previously Settled</span>
                    <span className="font-mono tabular-nums text-green-700">-{formatCurrency(settledEarlier, cur)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-neutral-500">Amount Received</span>
                  <span className="font-mono tabular-nums text-green-700">-{formatCurrency(received, cur)}</span>
                </div>
              </div>
              <div className={`mt-3 flex items-center justify-between rounded-md px-4 py-2.5 text-white ${
                balance > 0.005 ? "bg-[#0b3b60]" : "bg-green-700"}`}>
                <span className="text-sm font-bold">Balance Due</span>
                <span className="font-mono font-bold tabular-nums">{formatCurrency(balance, cur)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Signature */}
        <div className="mt-16 flex justify-end">
          <div className="w-52 border-t border-neutral-300 pt-1.5 text-center text-[11px] text-neutral-400">
            Authorized signature
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-3 border-t border-neutral-200 flex items-end justify-between text-[11px] text-neutral-400">
          <div className="flex items-end gap-2">
            {company?.logo_url && <img src={company.logo_url} alt="" className="h-4 max-w-[40px] object-contain" />}
            <div>
              <p className="font-semibold text-neutral-500">{company?.company_name || ""}</p>
              {company?.tax_id && <p>TIN: {company.tax_id}</p>}
            </div>
          </div>
          <p>Thank you for your payment</p>
        </div>
      </div>
    </div>
  );
}
