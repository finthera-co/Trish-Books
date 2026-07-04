import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import InvoicePreview from "@/components/invoice-designer/InvoicePreview";
import {
  getStandardTemplate,
  DEFAULT_TABLE_SETTINGS,
  DEFAULT_PAGE_SETTINGS,
  SAMPLE_INVOICE_DATA,
} from "@/components/invoice-designer/templateDefaults";
import { renderInvoiceHtml } from "@/components/invoice-designer/renderInvoice";

// jsdom has no canvas; html2canvas is only needed for PDF export, not preview.
vi.mock("html2canvas", () => ({ default: vi.fn() }));

describe("invoice preview rendering", () => {
  it("renderInvoiceHtml produces populated DOM from the standard template", () => {
    const node = renderInvoiceHtml({
      components: getStandardTemplate(),
      tableSettings: DEFAULT_TABLE_SETTINGS,
      pageSettings: DEFAULT_PAGE_SETTINGS,
      data: SAMPLE_INVOICE_DATA,
    });
    expect(node.children.length).toBeGreaterThan(5);
    expect(node.textContent).toContain("Finthera Ltd.");
    expect(node.textContent).toContain("INVOICE");
    const table = node.querySelector("table");
    expect(table).toBeTruthy();
    // Vector-PDF layout fixtures: # + merged Item & Description columns,
    // label/value meta rows, Balance Due chip, and the full totals ladder.
    const headers = Array.from(table!.querySelectorAll("th")).map((th) => th.textContent);
    expect(headers).toEqual(["#", "Item & Description", "Qty", "Rate", "Discount", "Amount"]);
    for (const t of ["Invoice#", "Invoice Date", "Terms", "Due Date", "Balance Due (LKR)",
      "Sub Total", "Discount", "Taxable amount", "Total", "Balance Due", "BILL TO"]) {
      expect(node.textContent).toContain(t);
    }
    // Bound fields with no data must print blank — never the designer placeholder.
    const empty = renderInvoiceHtml({
      components: getStandardTemplate(),
      tableSettings: DEFAULT_TABLE_SETTINGS,
      pageSettings: DEFAULT_PAGE_SETTINGS,
      data: { ...SAMPLE_INVOICE_DATA, customer_name: "", company_name: "" },
    });
    expect(empty.textContent).not.toContain("Customer Name");
    expect(empty.textContent).not.toContain("Company Name");
  });

  it("InvoicePreview dialog mounts the rendered invoice when open", async () => {
    render(
      <InvoicePreview
        open
        onOpenChange={() => {}}
        components={getStandardTemplate()}
        tableSettings={DEFAULT_TABLE_SETTINGS}
        pageSettings={DEFAULT_PAGE_SETTINGS}
        data={SAMPLE_INVOICE_DATA}
      />
    );
    expect(screen.getByText("Invoice Preview")).toBeTruthy();
    await waitFor(() => {
      expect(document.body.textContent).toContain("Finthera Ltd.");
    });
  });
});
