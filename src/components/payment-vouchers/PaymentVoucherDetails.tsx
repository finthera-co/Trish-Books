import { useRef } from "react";
import { usePaymentVoucher } from "@/hooks/usePaymentVouchers";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Printer, Download } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";

interface Props {
  voucherId: string | null;
}

export default function PaymentVoucherDetails({ voucherId }: Props) {
  const { data: voucher, isLoading } = usePaymentVoucher(voucherId || undefined);
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (!printRef.current) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>Payment Voucher ${voucher?.voucher_number}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
        h1 { text-align: center; margin-bottom: 4px; }
        .header-info { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 20px 0; font-size: 14px; }
        .header-info div { padding: 4px 0; }
        .label { font-weight: bold; color: #555; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; font-size: 13px; }
        th { background: #f5f5f5; font-weight: 600; }
        .total-row td { font-weight: bold; font-size: 15px; }
        .amount { text-align: right; }
        .approval-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 40px; text-align: center; }
        .approval-box { border-top: 1px solid #333; padding-top: 8px; font-size: 13px; }
        .approval-label { font-size: 11px; color: #888; margin-bottom: 24px; display: block; }
        @media print { body { padding: 20px; } }
      </style>
      </head><body>
      ${printRef.current.innerHTML}
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  if (isLoading) return <p className="text-center py-8 text-muted-foreground">Loading...</p>;
  if (!voucher) return <p className="text-center py-8 text-muted-foreground">Voucher not found</p>;

  const lines = (voucher as any).payment_voucher_lines || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Payment Voucher</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Download className="w-4 h-4 mr-1" /> Export PDF
          </Button>
        </div>
      </div>

      {/* Printable content */}
      <div ref={printRef}>
        <h1 style={{ textAlign: "center", fontSize: 22, fontWeight: 700, marginBottom: 4 }}>PAYMENT VOUCHER</h1>
        <p style={{ textAlign: "center", fontSize: 13, color: "#888", marginBottom: 16 }}>{voucher.voucher_number}</p>

        <div className="header-info" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 14 }}>
          <div><span className="label" style={{ fontWeight: 600, color: "#555" }}>Payee: </span>{(voucher as any).customers?.name || "—"}</div>
          <div><span className="label" style={{ fontWeight: 600, color: "#555" }}>Date: </span>{formatDate(voucher.payment_date)}</div>
          <div><span className="label" style={{ fontWeight: 600, color: "#555" }}>Payment Account: </span>{(voucher as any).accounts?.account_name || "—"}</div>
          <div><span className="label" style={{ fontWeight: 600, color: "#555" }}>Method: </span>{voucher.payment_method}</div>
          {voucher.account_number && <div><span className="label" style={{ fontWeight: 600, color: "#555" }}>Account #: </span>{voucher.account_number}</div>}
          {voucher.cheque_number && <div><span className="label" style={{ fontWeight: 600, color: "#555" }}>Cheque #: </span>{voucher.cheque_number}</div>}
          {voucher.reference_number && <div><span className="label" style={{ fontWeight: 600, color: "#555" }}>Reference: </span>{voucher.reference_number}</div>}
          {voucher.memo && <div><span className="label" style={{ fontWeight: 600, color: "#555" }}>Memo: </span>{voucher.memo}</div>}
          {voucher.bills_attached ? <div><span className="label" style={{ fontWeight: 600, color: "#555" }}>Bills Attached: </span>{voucher.bills_attached}</div> : null}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", margin: "20px 0" }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #ddd", padding: "8px 12px", background: "#f5f5f5", textAlign: "left" }}>Category</th>
              <th style={{ border: "1px solid #ddd", padding: "8px 12px", background: "#f5f5f5", textAlign: "left" }}>Description</th>
              <th style={{ border: "1px solid #ddd", padding: "8px 12px", background: "#f5f5f5", textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l: any) => (
              <tr key={l.id}>
                <td style={{ border: "1px solid #ddd", padding: "8px 12px" }}>
                  {l.accounts?.account_code} – {l.accounts?.account_name}
                </td>
                <td style={{ border: "1px solid #ddd", padding: "8px 12px" }}>{l.description || "—"}</td>
                <td style={{ border: "1px solid #ddd", padding: "8px 12px", textAlign: "right" }}>{formatCurrency(Number(l.amount))}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td colSpan={2} style={{ border: "1px solid #ddd", padding: "8px 12px", fontWeight: 700, textAlign: "right" }}>Total:</td>
              <td style={{ border: "1px solid #ddd", padding: "8px 12px", fontWeight: 700, textAlign: "right", fontSize: 16 }}>{formatCurrency(Number(voucher.total_amount))}</td>
            </tr>
          </tbody>
        </table>

        <div className="approval-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 40, textAlign: "center" }}>
          <div>
            <span className="approval-label" style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 24 }}>Made By</span>
            <div className="approval-box" style={{ borderTop: "1px solid #333", paddingTop: 8, fontSize: 13 }}>{voucher.made_by || "________________"}</div>
          </div>
          <div>
            <span className="approval-label" style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 24 }}>Checked By</span>
            <div className="approval-box" style={{ borderTop: "1px solid #333", paddingTop: 8, fontSize: 13 }}>{voucher.checked_by || "________________"}</div>
          </div>
          <div>
            <span className="approval-label" style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 24 }}>Accountant</span>
            <div className="approval-box" style={{ borderTop: "1px solid #333", paddingTop: 8, fontSize: 13 }}>{voucher.accountant || "________________"}</div>
          </div>
          <div>
            <span className="approval-label" style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 24 }}>Approved By</span>
            <div className="approval-box" style={{ borderTop: "1px solid #333", paddingTop: 8, fontSize: 13 }}>{voucher.approved_by || "________________"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
