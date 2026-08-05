import { formatCurrency } from "@/lib/currency";
import { formatInvoiceDate as formatDocDate } from "@/lib/format";

interface Props {
  quote: any;
  company: any;
}

// Zoho-style ESTIMATE document — company header, bill-to, line items, totals,
// notes/terms. Rendered on white for a clean print / PDF.
export default function QuoteDocument({ quote, company }: Props) {
  const items = [...(quote?.quote_items ?? [])].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const cust = quote?.customers;
  const lineAmount = (it: any) => Math.max(0, Number(it.quantity) * Number(it.unit_price) - Number(it.discount_amount || 0));
  // A Discount column appears only when at least one line is discounted, so an
  // undiscounted estimate keeps its clean four-column layout.
  const hasLineDiscount = items.some((it: any) => Number(it.discount_amount || 0) > 0);
  const discountCell = (it: any) => {
    const amt = Number(it.discount_amount || 0);
    if (amt <= 0) return "—";
    const pct = Number(it.discount_percent || 0);
    return pct > 0 ? `-${formatCurrency(amt)} (${pct}%)` : `-${formatCurrency(amt)}`;
  };

  return (
    <div id="estimate-doc" className="bg-white text-neutral-900 p-8 w-full text-sm">
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
          <h1 className="text-2xl font-bold tracking-tight text-neutral-800">ESTIMATE</h1>
          <p className="text-neutral-500 font-mono mt-1">{quote?.quote_number}</p>
        </div>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-6 py-6">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">Estimate for</p>
          <p className="font-semibold">{cust?.legal_name || cust?.name || "—"}</p>
          {cust?.address && <p className="text-neutral-500 whitespace-pre-line text-xs">{cust.address}</p>}
          {cust?.email && <p className="text-neutral-500 text-xs">{cust.email}</p>}
          {cust?.phone && <p className="text-neutral-500 text-xs">{cust.phone}</p>}
        </div>
        <div className="text-right space-y-1">
          <div className="flex justify-end gap-6"><span className="text-neutral-400">Estimate date</span><span className="font-medium w-28">{quote?.issue_date || "—"}</span></div>
          <div className="flex justify-end gap-6"><span className="text-neutral-400">Valid until</span><span className="font-medium w-28">{quote?.expiry_date || "—"}</span></div>
        </div>
      </div>

      {/* Line items */}
      <table className="w-full">
        <thead>
          <tr className="bg-neutral-800 text-white text-left text-xs">
            <th className="py-2 px-3 rounded-l">#</th>
            <th className="py-2 px-3">Item &amp; Description</th>
            <th className="py-2 px-3 text-right">Qty</th>
            <th className="py-2 px-3 text-right">Rate</th>
            {hasLineDiscount && <th className="py-2 px-3 text-right">Discount</th>}
            <th className="py-2 px-3 text-right rounded-r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it: any, idx: number) => (
            <tr key={it.id || idx} className="border-b border-neutral-100 align-top">
              <td className="py-2.5 px-3 text-neutral-400">{idx + 1}</td>
              <td className="py-2.5 px-3">{it.description || "—"}</td>
              <td className="py-2.5 px-3 text-right tabular-nums">{Number(it.quantity)}</td>
              <td className="py-2.5 px-3 text-right tabular-nums">{formatCurrency(Number(it.unit_price))}</td>
              {hasLineDiscount && <td className="py-2.5 px-3 text-right tabular-nums text-neutral-500">{discountCell(it)}</td>}
              <td className="py-2.5 px-3 text-right tabular-nums">{formatCurrency(lineAmount(it))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="flex justify-end pt-4">
        <div className="w-64 space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-neutral-500">Subtotal</span><span className="tabular-nums">{formatCurrency(Number(quote?.subtotal || 0))}</span></div>
          {Number(quote?.discount_amount || 0) > 0 && (
            <div className="flex justify-between"><span className="text-neutral-500">Discount</span><span className="tabular-nums text-red-600">-{formatCurrency(Number(quote.discount_amount))}</span></div>
          )}
          {Number(quote?.tax_amount || 0) > 0 && (
            <div className="flex justify-between"><span className="text-neutral-500">Tax</span><span className="tabular-nums">{formatCurrency(Number(quote.tax_amount))}</span></div>
          )}
          <div className="flex justify-between border-t border-neutral-300 pt-2 mt-1 font-bold text-base">
            <span>Total</span><span className="tabular-nums">{formatCurrency(Number(quote?.total_amount || 0))}</span>
          </div>
        </div>
      </div>

      {/* Notes / terms */}
      {(quote?.notes || quote?.terms) && (
        <div className="mt-8 pt-4 border-t border-neutral-200 grid grid-cols-2 gap-6 text-xs">
          {quote?.notes && <div><p className="uppercase tracking-wide text-neutral-400 mb-1">Notes</p><p className="text-neutral-600 whitespace-pre-line">{quote.notes}</p></div>}
          {quote?.terms && <div><p className="uppercase tracking-wide text-neutral-400 mb-1">Terms &amp; Conditions</p><p className="text-neutral-600 whitespace-pre-line">{quote.terms}</p></div>}
        </div>
      )}

      <p className="mt-8 text-[11px] font-semibold text-neutral-500 text-center">
        {quote?.expiry_date
          ? `Prices are valid only if accepted on or before ${formatDocDate(quote.expiry_date)}.`
          : "Prices are subject to change until accepted in writing."}
      </p>
    </div>
  );
}
