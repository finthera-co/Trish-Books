import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, Loader2, Printer, Receipt } from "lucide-react";
import { toast } from "sonner";
import { buildInvoicePdfDocument } from "@/lib/invoiceDownload";
import { useInvoiceReceipt } from "@/hooks/useInvoiceReceipts";
import { formatInvoiceDate } from "@/lib/format";

interface Props {
  invoiceId?: string | null;
  tenantId?: string | null;
  invoiceNumber?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Reads the invoice as the customer will receive it.
 *
 * Deliberately renders the REAL PDF rather than a look-alike HTML mock: it goes
 * through buildInvoicePdfDocument, the same call the Download button makes, so
 * the page on screen and the file on disk can never disagree — including
 * whether the PAID stamp is on it.
 */
export default function InvoiceDocumentViewer({ invoiceId, tenantId, invoiceNumber, open, onOpenChange }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("invoice.pdf");
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { data: receipt } = useInvoiceReceipt(open ? invoiceId : null);

  useEffect(() => {
    if (!open || !invoiceId || !tenantId) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setError(null);

    (async () => {
      try {
        const { pdf, fileName: name } = await buildInvoicePdfDocument(invoiceId, tenantId);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(pdf.output("blob"));
        setFileName(name);
        setUrl(objectUrl);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Could not render this invoice");
      }
    })();

    return () => {
      cancelled = true;
      // Revoked on close so a long session doesn't accumulate document-sized blobs.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // `receipt` is a dependency on purpose: issuing a receipt adds the PAID
    // stamp, so the open document must be re-rendered to show it.
  }, [open, invoiceId, tenantId, receipt?.id]);

  const download = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  };

  const openInTab = () => {
    if (!url) return;
    if (!window.open(url, "_blank", "noopener")) toast.error("Your browser blocked the popup");
  };

  // The frame holds a same-origin blob, so its own print dialog is reachable.
  // Browsers that refuse to print an embedded PDF fall back to a new tab.
  const print = () => {
    const frame = frameRef.current;
    try {
      if (!frame?.contentWindow) throw new Error("no frame");
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      openInTab();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-3">
            <span>Invoice {invoiceNumber || ""}</span>
            {receipt && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                <Receipt className="w-3.5 h-3.5" />
                Receipted · {receipt.receipt_number}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {receipt
              ? `Settled by receipt ${receipt.receipt_number} on ${formatInvoiceDate(receipt.receipt_date)} — the document below carries the PAID stamp.`
              : "Exactly the document that downloads and that the customer receives."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[55vh] flex-1 overflow-hidden rounded-lg border border-border bg-muted/30">
          {error ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-destructive">{error}</div>
          ) : !url ? (
            <div className="flex h-full items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Rendering invoice…
            </div>
          ) : (
            <iframe ref={frameRef} src={url} title={`Invoice ${invoiceNumber || ""}`} className="h-full w-full min-h-[55vh]" />
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={openInTab} disabled={!url}>
            <ExternalLink className="mr-1.5 h-4 w-4" /> Open in new tab
          </Button>
          <Button variant="outline" onClick={print} disabled={!url}>
            <Printer className="mr-1.5 h-4 w-4" /> Print
          </Button>
          <Button onClick={download} disabled={!url}>
            <Download className="mr-1.5 h-4 w-4" /> Download PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
