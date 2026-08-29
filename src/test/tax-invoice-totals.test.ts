import { describe, it, expect } from "vitest";
import { totalsRows } from "@/lib/taxInvoicePdf";
import type { TaxInvoiceModel } from "@/lib/taxInvoiceData";

const model = (over: Partial<TaxInvoiceModel>): TaxInvoiceModel => ({
  supplier: { tin: "", name: "", address: "", phone: "" },
  purchaser: { tin: "", name: "", address: "", phone: "" },
  invoiceNo: "", dateOfInvoice: "", dateOfSupply: "", placeOfSupply: "",
  additionalInfo: "", modeOfPayment: "", descriptionHeader: "Description of Services",
  lines: [], totalValueOfSupply: 0, vatBands: [{ rate: 0, base: 0, vat: 0 }],
  vatAmount: 0, totalIncludingVat: 0, totalInWords: "", currency: "LKR",
  apportioned: false,
  ...over,
});

describe("totalsRows", () => {
  it("names the rate actually charged on a single-rate invoice", () => {
    const rows = totalsRows(model({
      totalValueOfSupply: 60000, vatAmount: 10800, totalIncludingVat: 70800,
      vatBands: [{ rate: 18, base: 60000, vat: 10800 }],
    }));
    expect(rows.map((r) => r.label)).toEqual([
      "Total Value of Supply:",
      "VAT Amount (Total Value of Supply @ 18%):",
      "Total Amount/consideration including VAT:",
    ]);
    expect(rows.map((r) => r.value)).toEqual(["LKR 60,000.00", "LKR 10,800.00", "LKR 70,800.00"]);
  });

  it("breaks a mixed-rate invoice out per rate, then totals the VAT", () => {
    const rows = totalsRows(model({
      totalValueOfSupply: 150000, vatAmount: 18000, totalIncludingVat: 168000,
      vatBands: [{ rate: 18, base: 100000, vat: 18000 }, { rate: 0, base: 50000, vat: 0 }],
    }));
    expect(rows.map((r) => r.label)).toEqual([
      "Total Value of Supply:",
      "VAT Amount (LKR 100,000.00 @ 18%):",
      "VAT Amount (LKR 50,000.00 @ 0%):",
      "Total VAT Amount:",
      "Total Amount/consideration including VAT:",
    ]);
  });

  it("still states a rate when nothing was charged", () => {
    expect(totalsRows(model({})).map((r) => r.label)).toContain(
      "VAT Amount (Total Value of Supply @ 0%):"
    );
  });
});
