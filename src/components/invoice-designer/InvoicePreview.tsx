import { useEffect, useRef, useState, type RefObject } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Printer, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { PaidStamp } from "@/lib/paidStamp";
import type { DesignerComponent, TableSettings, InvoiceData, PageSettings } from "./types";
import {
  renderInvoiceHtml,
  reflowTables,
  applyWatermarks,
  applyPageFooter,
  applyPaidStamp,
  waitForImages,
  renderToPdf,
  PAGE_FOOTER_H,
  type RenderInput,
} from "./renderInvoice";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  components: DesignerComponent[];
  tableSettings: TableSettings;
  pageSettings: PageSettings;
  data: InvoiceData;
  /** Set for a real invoice that has been receipted; the designer leaves it off. */
  paidStamp?: PaidStamp | null;
}

/**
 * The invoice surface. Must be its own component INSIDE DialogContent: Radix
 * mounts portal content after the dialog owner's effects run, so an effect in
 * the parent fires while the host ref is still null and the preview stays
 * blank. Here the effect belongs to the mounted subtree, so the ref is set.
 */
function PreviewSurface({ input, hostRef }: { input: RenderInput; hostRef: RefObject<HTMLDivElement> }) {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";
    const node = renderInvoiceHtml(input);
    host.appendChild(node);
    let cancelled = false;
    (async () => {
      await waitForImages(node);
      if (cancelled) return;
      const footerReserve = input.pageSettings.pageFooter?.enabled ? PAGE_FOOTER_H : 0;
      reflowTables(node, footerReserve);
      applyPaidStamp(node, input.paidStamp, footerReserve);
      applyWatermarks(node, input.pageSettings);
      applyPageFooter(node, input.pageSettings, input.data);
    })();
    return () => {
      cancelled = true;
      host.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.components, input.tableSettings, input.pageSettings, input.data, input.paidStamp]);

  return <div ref={hostRef} className="mx-auto shadow-lg" style={{ width: 595 }} />;
}

/**
 * Preview dialog. Renders through the SAME pipeline as the real invoice
 * download (renderInvoice.ts), so what's shown here is exactly what a
 * customer-facing PDF will look like — including reflow and watermarks.
 */
export default function InvoicePreview({ open, onOpenChange, components, tableSettings, pageSettings, data, paidStamp }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const input: RenderInput = { components, tableSettings, pageSettings, data, paidStamp };

  const exportPdf = async () => {
    setExporting(true);
    try {
      const pdf = await renderToPdf(input);
      pdf.save(`invoice-${data.invoice_number || "preview"}.pdf`);
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = () => {
    const node = hostRef.current?.firstElementChild as HTMLElement | null;
    if (!node) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(
      "<html><head><title>Invoice</title><style>body{margin:0;padding:0;}@page{margin:0;}</style></head><body>"
    );
    printWindow.document.write(node.outerHTML);
    printWindow.document.write("</body></html>");
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[700px] max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Invoice Preview</span>
            <div className="flex gap-2 mr-6">
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="w-3.5 h-3.5 mr-1" />Print
              </Button>
              <Button size="sm" onClick={exportPdf} disabled={exporting}>
                {exporting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />}
                PDF
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="border bg-muted/30 p-4 overflow-auto">
          <PreviewSurface input={input} hostRef={hostRef} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
