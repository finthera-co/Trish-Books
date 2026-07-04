import { formatCurrency } from "@/lib/currency";
import { amountInWords } from "@/lib/numberToWords";

export interface ReceiptModel {
  receiptNumber: string;
  receiptDate: string;
  receivedFrom: string;
  customerAddress?: string | null;
  invoiceNumber?: string | null;
  amount: number;
  paymentMethod?: string | null;
  reference?: string | null;
  balanceDue?: number | null;
  notes?: string | null;
  currency?: string;
}

const methodLabel = (m?: string | null) =>
  m ? m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";

// Zoho-style payment receipt — proof of money received against an invoice.
export default function ReceiptDocument({ model, company }: { model: ReceiptModel; company: any }) {
  const cur = model.currency || "LKR";
  const wordsUnit = cur === "LKR" ? "Rupees" : cur;
  return (
    <div id="receipt-doc" className="bg-white text-neutral-900 p-8 w-full text-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-6 pb-6 border-b border-neutral-200">
        <div className="flex items-center gap-4">
          {company?.logo_url
            ? <img src={company.logo_url} alt="Logo" className="h-16 w-16 object-contain" />
            : <div className="h-16 w-16 rounded-lg bg-neutral-100 flex items-center justify-center text-neutral-400 text-xs">Logo</div>}
          <div>
            <h2 className="text-lg font-bold">{company?.company_name || "Your Company"}</h2>
            {company?.address && <p className="text-neutral-500 whitespace-pre-line text-xs">{company.address}</p>}
            {company?.phone && <p className="text-neutral-500 text-xs">{company.phone}</p>}
            {company?.tax_id && <p className="text-neutral-500 text-xs">TIN: {company.tax_id}</p>}
          </div>
        </div>
        <div className="text-right">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-800">PAYMENT RECEIPT</h1>
          <p className="text-neutral-500 font-mono mt-1">{model.receiptNumber}</p>
          <p className="text-neutral-500 text-xs mt-1">{model.receiptDate}</p>
        </div>
      </div>

      {/* Received from + amount box */}
      <div className="grid grid-cols-2 gap-6 py-6 items-start">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">Received from</p>
          <p className="font-semibold">{model.receivedFrom || "—"}</p>
          {model.customerAddress && <p className="text-neutral-500 whitespace-pre-line text-xs">{model.customerAddress}</p>}
        </div>
        <div className="rounded-lg bg-neutral-800 text-white p-4 text-right">
          <p className="text-[11px] uppercase tracking-wide text-neutral-300">Amount received</p>
          <p className="text-2xl font-bold tabular-nums">{formatCurrency(model.amount, cur)}</p>
        </div>
      </div>

      {/* Amount in words */}
      <div className="rounded-md bg-neutral-50 border border-neutral-200 px-3 py-2 text-xs">
        <span className="text-neutral-400">In words: </span>
        <span className="text-neutral-700 italic">{amountInWords(model.amount, wordsUnit)}</span>
      </div>

      {/* Details */}
      <table className="w-full mt-6">
        <thead>
          <tr className="bg-neutral-800 text-white text-left text-xs">
            <th className="py-2 px-3 rounded-l">Invoice #</th>
            <th className="py-2 px-3">Payment method</th>
            <th className="py-2 px-3">Reference</th>
            <th className="py-2 px-3 text-right rounded-r">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-neutral-100">
            <td className="py-2.5 px-3 font-medium">{model.invoiceNumber || "—"}</td>
            <td className="py-2.5 px-3">{methodLabel(model.paymentMethod)}</td>
            <td className="py-2.5 px-3 text-neutral-500">{model.reference || "—"}</td>
            <td className="py-2.5 px-3 text-right tabular-nums">{formatCurrency(model.amount, cur)}</td>
          </tr>
        </tbody>
      </table>

      {/* Balance */}
      {model.balanceDue != null && (
        <div className="flex justify-end pt-4">
          <div className="w-64 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-neutral-500">Amount received</span><span className="tabular-nums">{formatCurrency(model.amount, cur)}</span></div>
            <div className="flex justify-between border-t border-neutral-300 pt-2 mt-1 font-semibold">
              <span>Balance due</span>
              <span className={`tabular-nums ${model.balanceDue > 0 ? "text-red-600" : "text-green-700"}`}>{formatCurrency(model.balanceDue, cur)}</span>
            </div>
          </div>
        </div>
      )}

      {model.notes && (
        <div className="mt-6 pt-4 border-t border-neutral-200 text-xs">
          <p className="uppercase tracking-wide text-neutral-400 mb-1">Notes</p>
          <p className="text-neutral-600 whitespace-pre-line">{model.notes}</p>
        </div>
      )}

      <div className="mt-10 flex justify-between items-end">
        <p className="text-[11px] text-neutral-400">Thank you for your payment.</p>
        <div className="text-center">
          <div className="w-40 border-t border-neutral-300 pt-1 text-[11px] text-neutral-500">Authorized signature</div>
        </div>
      </div>
    </div>
  );
}
