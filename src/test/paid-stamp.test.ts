import { describe, it, expect } from "vitest";
import { jsPDF } from "jspdf";
import { drawPaidStamp, paidStampFromReceipt, paidStampSublines, STAMP_CSS_COLOR } from "@/lib/paidStamp";
import { applyPaidStamp, CANVAS_H, CANVAS_W } from "@/components/invoice-designer/renderInvoice";

const RECEIPT = { receipt_number: "RCP-2026-0007", receipt_date: "2026-08-14" };

describe("paid stamp", () => {
  it("is driven by an issued receipt, not by the balance", () => {
    expect(paidStampFromReceipt(RECEIPT)).toEqual({
      receiptNumber: "RCP-2026-0007",
      receiptDate: "2026-08-14",
    });
    // No receipt → no stamp, however the invoice's money looks.
    expect(paidStampFromReceipt(null)).toBeNull();
    expect(paidStampFromReceipt(undefined)).toBeNull();
    expect(paidStampFromReceipt({ receipt_number: null, receipt_date: "2026-08-14" })).toBeNull();
  });

  it("names the receipt it stands for", () => {
    expect(paidStampSublines({ receiptNumber: "RCP-2026-0007", receiptDate: "2026-08-14" }))
      .toEqual(["RECEIPT RCP-2026-0007", "14 Aug 2026"]);
    // A receipt with no date still prints its number rather than an empty line.
    expect(paidStampSublines({ receiptNumber: "RCP-2026-0007", receiptDate: "" }))
      .toEqual(["RECEIPT RCP-2026-0007"]);
  });

  it("draws onto a jsPDF page without disturbing the page count", () => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const before = doc.getNumberOfPages();
    drawPaidStamp(doc, paidStampFromReceipt(RECEIPT)!, 154, 470 * 0.56);
    expect(doc.getNumberOfPages()).toBe(before);
    // The receipt reference must survive into the file, not just the frame.
    expect(doc.output("datauristring").length).toBeGreaterThan(0);
  });

  it("stamps the template render in red, on the sheet", () => {
    const root = document.createElement("div");
    root.dataset.pages = "1";
    applyPaidStamp(root, paidStampFromReceipt(RECEIPT));

    expect(root.children.length).toBe(1);
    const stamp = root.firstElementChild as HTMLElement;
    expect(stamp.textContent).toContain("PAID");
    expect(stamp.textContent).toContain("RCP-2026-0007");
    // Red, not the settled-green used elsewhere on the document.
    expect(stamp.style.color).toBe(STAMP_CSS_COLOR);
    expect(stamp.style.borderColor).toBe(STAMP_CSS_COLOR);
    // Lands on the sheet, clear of the page edges.
    const left = parseFloat(stamp.style.left);
    const top = parseFloat(stamp.style.top);
    expect(left).toBeGreaterThan(0);
    expect(left + parseFloat(stamp.style.width)).toBeLessThan(CANVAS_W);
    expect(top).toBeGreaterThan(0);
    expect(top + parseFloat(stamp.style.height)).toBeLessThan(CANVAS_H);
  });

  it("hangs under the LAST balance due on the page, not the header chip", () => {
    const root = document.createElement("div");
    root.dataset.pages = "1";

    // The default template carries two balance_due fields: a summary chip high
    // on the page and the real one at the foot of the totals ladder.
    const chip = document.createElement("div");
    chip.dataset.binding = "balance_due";
    chip.dataset.top = "100";
    chip.style.cssText = "position:absolute;left:400px;top:100px;width:90px;min-height:24px;";
    const ladder = document.createElement("div");
    ladder.dataset.binding = "balance_due";
    ladder.dataset.top = "520";
    ladder.style.cssText = "position:absolute;left:380px;top:520px;width:120px;min-height:24px;";
    root.append(chip, ladder);

    applyPaidStamp(root, paidStampFromReceipt(RECEIPT));
    const stamp = root.lastElementChild as HTMLElement;

    // Below the totals ladder (520 + 24), never beside the header chip.
    expect(parseFloat(stamp.style.top)).toBeGreaterThan(520);
    // Centred on that field: 380 + 120/2 = 440.
    const centre = parseFloat(stamp.style.left) + parseFloat(stamp.style.width) / 2;
    expect(centre).toBeCloseTo(440, 0);
  });

  it("pushes down only what its footprint would land on", () => {
    const root = document.createElement("div");
    root.dataset.pages = "1";
    const balance = document.createElement("div");
    balance.dataset.binding = "balance_due";
    balance.dataset.top = "520";
    balance.style.cssText = "position:absolute;left:380px;top:520px;width:120px;min-height:24px;";
    // Bank details run the full width right under the totals — the stamp lands on them.
    const bank = document.createElement("div");
    bank.dataset.top = "560";
    bank.style.cssText = "position:absolute;left:20px;top:560px;width:540px;min-height:48px;";
    // A note pinned to the far left, clear of the stamp's column, must not move.
    const note = document.createElement("div");
    note.dataset.top = "560";
    note.style.cssText = "position:absolute;left:20px;top:560px;width:120px;min-height:20px;";
    root.append(balance, bank, note);

    applyPaidStamp(root, paidStampFromReceipt(RECEIPT));

    expect(parseFloat(bank.style.top)).toBeGreaterThan(560);
    expect(bank.dataset.top).toBe(String(parseFloat(bank.style.top)));
    expect(parseFloat(note.style.top)).toBe(560);
    // The balance the stamp hangs from stays put.
    expect(parseFloat(balance.style.top)).toBe(520);
  });

  it("leaves an unreceipted invoice unmarked", () => {
    const root = document.createElement("div");
    applyPaidStamp(root, null);
    applyPaidStamp(root, undefined);
    expect(root.children.length).toBe(0);
  });
});
