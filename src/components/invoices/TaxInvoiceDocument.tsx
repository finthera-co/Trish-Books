import { formatCurrency } from "@/lib/currency";
import type { TaxInvoiceModel } from "@/lib/taxInvoiceData";

/**
 * Read-only statutory VAT Tax Invoice (IRD Gazette 2481/22, Annexure I).
 *
 * The layout, field labels, ordering and date format are mandated by the
 * gazette and must NOT be restyled. Monochrome, thin black borders, A4
 * proportions — print friendly. Asterisks in labels are printed literally;
 * they denote optional fields per the gazette legend.
 */
export default function TaxInvoiceDocument({ model }: { model: TaxInvoiceModel }) {
  // Mirror the specimen: pad the body to at least 4 rows.
  const MIN_ROWS = 4;
  const emptyRows = Math.max(0, MIN_ROWS - model.lines.length);

  const cell = "border border-black px-2 py-1 align-top";
  const labelLine = (label: string, value: string) => (
    <div className="leading-snug">
      <span className="font-semibold">{label}</span> {value}
    </div>
  );

  return (
    <div className="mx-auto bg-white text-black" style={{ width: "210mm", padding: "15mm", fontFamily: "Arial, Helvetica, sans-serif", fontSize: "11px" }}>
      {/* Title */}
      <div className="flex justify-center mb-3">
        <div className="border-2 border-black px-8 py-2 text-center">
          <span className="text-lg font-bold tracking-wide">TAX INVOICE</span>
        </div>
      </div>

      {/* Supplier / Purchaser header */}
      <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
        <tbody>
          <tr>
            <td className={cell} style={{ width: "50%" }}>
              {labelLine("Date of Invoice:", model.dateOfInvoice)}
              <div className="mt-2 space-y-0.5">
                {labelLine("Supplier's TIN:", model.supplier.tin)}
                {labelLine("Supplier's Name:", model.supplier.name)}
                {labelLine("Address:", model.supplier.address)}
                {labelLine("Telephone No.:*", model.supplier.phone)}
              </div>
            </td>
            <td className={cell} style={{ width: "50%" }}>
              {labelLine("Tax Invoice No.:", model.invoiceNo)}
              <div className="mt-2 space-y-0.5">
                {labelLine("Purchaser's TIN:", model.purchaser.tin)}
                {labelLine("Purchaser's Name:", model.purchaser.name)}
                {labelLine("Address:", model.purchaser.address)}
                {labelLine("Telephone No.:*", model.purchaser.phone)}
              </div>
            </td>
          </tr>
          <tr>
            <td className={cell}>{labelLine("Date of Supply:", model.dateOfSupply)}</td>
            <td className={cell}>{labelLine("Place of Supply:*", model.placeOfSupply)}</td>
          </tr>
          <tr>
            <td className={cell} colSpan={2}>{labelLine("Additional Information if any:*", model.additionalInfo)}</td>
          </tr>
        </tbody>
      </table>

      {/* Line items */}
      <table className="w-full border-collapse mt-2" style={{ tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th className={cell + " text-left"} style={{ width: "12%" }}>Reference*</th>
            <th className={cell + " text-left"} style={{ width: "40%" }}>{model.descriptionHeader}</th>
            <th className={cell + " text-right"} style={{ width: "11%" }}>Quantity</th>
            <th className={cell + " text-right"} style={{ width: "16%" }}>Unit Price</th>
            <th className={cell + " text-right"} style={{ width: "21%" }}>Amount Excluding VAT (Rs.)</th>
          </tr>
        </thead>
        <tbody>
          {model.lines.map((l, i) => (
            <tr key={i}>
              <td className={cell}>{l.reference}</td>
              <td className={cell}>{l.description}</td>
              <td className={cell + " text-right tabular-nums"}>{l.qty || ""}</td>
              <td className={cell + " text-right tabular-nums"}>{l.unitPrice ? formatCurrency(l.unitPrice) : ""}</td>
              <td className={cell + " text-right tabular-nums"}>{formatCurrency(l.amountExVat)}</td>
            </tr>
          ))}
          {Array.from({ length: emptyRows }).map((_, i) => (
            <tr key={`e${i}`}>
              <td className={cell}>&nbsp;</td>
              <td className={cell}></td>
              <td className={cell}></td>
              <td className={cell}></td>
              <td className={cell}></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
        <tbody>
          <tr>
            <td className={cell + " text-right font-semibold"} style={{ width: "79%" }}>Total Value of Supply:</td>
            <td className={cell + " text-right tabular-nums"} style={{ width: "21%" }}>{formatCurrency(model.totalValueOfSupply)}</td>
          </tr>
          <tr>
            <td className={cell + " text-right font-semibold"}>VAT Amount (Total Value of Supply @ VAT Rate):</td>
            <td className={cell + " text-right tabular-nums"}>{formatCurrency(model.vatAmount)}</td>
          </tr>
          <tr>
            <td className={cell + " text-right font-semibold"}>Total Amount/consideration including VAT:</td>
            <td className={cell + " text-right tabular-nums"}>{formatCurrency(model.totalIncludingVat)}</td>
          </tr>
          <tr>
            <td className={cell} colSpan={2}>{labelLine("Total Amount in words:*", model.totalInWords)}</td>
          </tr>
          <tr>
            <td className={cell} colSpan={2}>{labelLine("Mode of Payment:*", model.modeOfPayment)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
