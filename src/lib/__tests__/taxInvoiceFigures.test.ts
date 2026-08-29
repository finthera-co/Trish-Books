import { describe, it, expect } from "vitest";
import {
  amountInWords,
  computeTaxInvoiceFigures,
  formatRate,
  unitPriceFor,
  TaxInvoiceError,
  type TaxLineInput,
  type TaxTxnInput,
} from "@/lib/taxInvoiceData";

const vat = (over: Partial<TaxTxnInput>): TaxTxnInput => ({
  source_line_id: "L1",
  base_amount: 0,
  tax_amount: 0,
  rate_applied: 18,
  tax_codes: { tax_type: "VAT", collection_mode: "output" },
  ...over,
});

const line = (over: Partial<TaxLineInput>): TaxLineInput => ({
  id: "L1", quantity: 1, unit_price: 0, discount_amount: 0, ...over,
});

describe("computeTaxInvoiceFigures — posted sub-ledger", () => {
  it("takes the line's value of supply and VAT straight from the ledger", () => {
    const { lines, apportioned } = computeTaxInvoiceFigures({
      items: [line({ unit_price: 60000 })],
      txns: [vat({ base_amount: 60000, tax_amount: 10800 })],
      subtotal: 60000, taxAmount: 10800, totalAmount: 70800,
    });
    expect(apportioned).toBe(false);
    expect(lines).toEqual([{ amountExVat: 60000, vat: 10800, rate: 18 }]);
  });

  it("backs VAT out of a tax-inclusive line without touching the gross unit price", () => {
    // unit_price is the GROSS rate on an inclusive line; the ledger holds the net.
    const { lines } = computeTaxInvoiceFigures({
      items: [line({ unit_price: 70800, is_tax_inclusive: true })],
      txns: [vat({ base_amount: 60000, tax_amount: 10800 })],
      subtotal: 60000, taxAmount: 10800, totalAmount: 70800,
    });
    expect(lines[0]).toEqual({ amountExVat: 60000, vat: 10800, rate: 18 });
  });

  it("does not spread VAT onto an exempt line sitting beside a rated one", () => {
    const { lines } = computeTaxInvoiceFigures({
      items: [line({ id: "A", unit_price: 100000 }), line({ id: "B", unit_price: 50000 })],
      txns: [vat({ source_line_id: "A", base_amount: 100000, tax_amount: 18000 })],
      subtotal: 150000, taxAmount: 18000, totalAmount: 168000,
    });
    expect(lines).toEqual([
      { amountExVat: 100000, vat: 18000, rate: 18 },
      { amountExVat: 50000, vat: 0, rate: 0 },
    ]);
  });

  it("puts a compound levy inside the value of supply, not beside it", () => {
    // SSCL 2.5% on 100,000, then VAT 18% on 102,500.
    const { lines } = computeTaxInvoiceFigures({
      items: [line({ unit_price: 100000 })],
      txns: [
        vat({ base_amount: 100000, tax_amount: 2500, rate_applied: 2.5, tax_codes: { tax_type: "SSCL", collection_mode: "output" } }),
        vat({ base_amount: 102500, tax_amount: 18450 }),
      ],
      // tax_amount carries SSCL + VAT; the value of supply carries SSCL only.
      subtotal: 100000, taxAmount: 20950, totalAmount: 120950,
    });
    expect(lines[0]).toEqual({ amountExVat: 102500, vat: 18450, rate: 18 });
  });

  it("ignores withholding, which is never a charge to the customer", () => {
    const { lines } = computeTaxInvoiceFigures({
      items: [line({ unit_price: 100000 })],
      txns: [
        vat({ base_amount: 100000, tax_amount: 18000 }),
        vat({ base_amount: 100000, tax_amount: 5000, rate_applied: 5, tax_codes: { tax_type: "WHT", collection_mode: "withholding_payable" } }),
      ],
      subtotal: 100000, taxAmount: 18000, totalAmount: 118000,
    });
    expect(lines[0]).toEqual({ amountExVat: 100000, vat: 18000, rate: 18 });
  });

  it("refuses to print figures that disagree with the posted total", () => {
    expect(() =>
      computeTaxInvoiceFigures({
        items: [line({ unit_price: 100000 })],
        txns: [vat({ base_amount: 100000, tax_amount: 18000 })],
        subtotal: 100000, taxAmount: 18000, totalAmount: 999999,
      })
    ).toThrow(TaxInvoiceError);
  });

  it("translates a foreign-currency line into Rs. at the posted rate", () => {
    // The ledger already holds LKR; an untaxed line is converted from the doc currency.
    const { lines } = computeTaxInvoiceFigures({
      items: [line({ id: "A", unit_price: 100 }), line({ id: "B", unit_price: 50 })],
      txns: [vat({ source_line_id: "A", base_amount: 30000, tax_amount: 5400 })],
      subtotal: 150, taxAmount: 18, totalAmount: 168, fx: 300,
    });
    expect(lines).toEqual([
      { amountExVat: 30000, vat: 5400, rate: 18 },
      { amountExVat: 15000, vat: 0, rate: 0 },
    ]);
  });
});

describe("computeTaxInvoiceFigures — legacy invoices", () => {
  it("reconstructs an exclusive legacy line from its own tax rate", () => {
    const { lines, apportioned } = computeTaxInvoiceFigures({
      items: [line({ quantity: 2, unit_price: 5000, tax_id: "t1", taxes: { tax_rate: 15 } })],
      txns: [],
      subtotal: 10000, taxAmount: 1500, totalAmount: 11500,
    });
    expect(apportioned).toBe(false);
    expect(lines).toEqual([{ amountExVat: 10000, vat: 1500, rate: 15 }]);
  });

  it("reconstructs an inclusive legacy line", () => {
    const { lines } = computeTaxInvoiceFigures({
      items: [line({ unit_price: 11500, is_tax_inclusive: true, tax_id: "t1", taxes: { tax_rate: 15 } })],
      txns: [],
      subtotal: 10000, taxAmount: 1500, totalAmount: 11500,
    });
    expect(lines).toEqual([{ amountExVat: 10000, vat: 1500, rate: 15 }]);
  });

  it("apportions only when the line detail cannot be reconstructed, and foots exactly", () => {
    const { lines, apportioned } = computeTaxInvoiceFigures({
      items: [line({ id: "A", unit_price: 30000 }), line({ id: "B", unit_price: 10000 })],
      txns: [],
      subtotal: 40000, taxAmount: 7200, totalAmount: 47200,
    });
    expect(apportioned).toBe(true);
    expect(lines.reduce((s, l) => s + l.amountExVat, 0)).toBe(40000);
    expect(lines.reduce((s, l) => s + l.vat, 0)).toBe(7200);
    expect(lines[0].rate).toBeCloseTo(18, 10);
  });

  it("nets the line's share of an invoice-level discount", () => {
    const { lines } = computeTaxInvoiceFigures({
      items: [line({ quantity: 2, unit_price: 5000, discount_amount: 1000, tax_id: "t1", taxes: { tax_rate: 15 } })],
      txns: [],
      subtotal: 9000, taxAmount: 1350, totalAmount: 10350,
    });
    expect(lines).toEqual([{ amountExVat: 9000, vat: 1350, rate: 15 }]);
  });
});

describe("unitPriceFor", () => {
  it("keeps 2 decimals when they reproduce the amount", () => {
    expect(unitPriceFor(60000, 1)).toEqual({ unitPrice: 60000, decimals: 2 });
    expect(unitPriceFor(10000, 2)).toEqual({ unitPrice: 5000, decimals: 2 });
  });

  it("widens the price until qty x price foots to the amount", () => {
    expect(unitPriceFor(100, 3)).toEqual({ unitPrice: 33.333, decimals: 3 });
    const { unitPrice, decimals } = unitPriceFor(1000, 7);
    expect(Math.abs(unitPrice * 7 - 1000)).toBeLessThan(0.005);
    expect(decimals).toBeGreaterThan(2);
  });

  it("shows the whole amount when there is no quantity", () => {
    expect(unitPriceFor(500, 0)).toEqual({ unitPrice: 500, decimals: 2 });
  });
});

describe("formatRate", () => {
  it("states the rate without trailing zeros", () => {
    expect(formatRate(18)).toBe("18%");
    expect(formatRate(7.5)).toBe("7.5%");
    expect(formatRate(2.04)).toBe("2.04%");
    expect(formatRate(0)).toBe("0%");
  });
});

describe("amountInWords", () => {
  it("writes rupees and cents the way the gazette line expects", () => {
    expect(amountInWords(70800)).toBe("Seventy Thousand Eight Hundred Rupees Only");
    expect(amountInWords(1)).toBe("One Rupee Only");
    expect(amountInWords(0)).toBe("Zero Rupees Only");
    expect(amountInWords(1234.56)).toBe("One Thousand Two Hundred Thirty Four Rupees and Fifty Six Cents Only");
  });

  it("handles amounts past ninety-nine crore", () => {
    // 1,050,000,000 = 105 crore.
    expect(amountInWords(1050000000)).toBe("One Hundred Five Crore Rupees Only");
  });
});
