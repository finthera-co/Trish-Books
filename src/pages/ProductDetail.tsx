import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Package, TrendingUp, FileText, Hash, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useProductSalesDetail } from "@/hooks/useData";
import { downloadDataExcel, type DataColumn } from "@/lib/reportExcel";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Same canonical status vocabulary/colors as src/pages/Invoices.tsx.
const statusColors: Record<string, string> = {
  paid: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  posted: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  draft: "bg-muted text-muted-foreground",
  voided: "bg-destructive/10 text-destructive line-through",
};

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { appUser } = useAuth();
  const { data, isLoading } = useProductSalesDetail(id);

  const { data: company } = useQuery({
    queryKey: ["company_hdr", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants")
        .select("company_name, address, phone, tax_id").eq("id", appUser!.tenant_id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  usePageTitle(data?.product?.name);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading product...</div>;
  if (!data) return <div className="p-8 text-muted-foreground">Product not found</div>;

  const { product, lines, totalQty, totalRevenue, invoiceCount, avgPrice } = data;

  const handleDownloadExcel = () => {
    const columns: DataColumn<(typeof lines)[number]>[] = [
      { header: "Invoice #", value: (l) => l.invoices.invoice_number },
      { header: "Date", value: (l) => formatDate(l.invoices.issue_date) },
      { header: "Customer", value: (l) => l.invoices.customers?.name || "" },
      { header: "Status", value: (l) => l.invoices.status },
      { header: "Qty", value: (l) => Number(l.quantity), numeric: true },
      { header: "Unit Price", value: (l) => Number(l.unit_price), numeric: true },
      { header: "Total", value: (l) => Number(l.total), numeric: true },
    ];
    const totalRow = ["", "", "", "Total (posted, non-voided)", totalQty, "", totalRevenue];

    const ok = downloadDataExcel(
      {
        companyName: company?.company_name,
        address: company?.address,
        phone: company?.phone,
        taxId: company?.tax_id,
        title: "Product Sales Summary",
        subtitle: product.name,
        sheetName: "Sales",
        fileName: `Product Sales — ${product.name}.xlsx`,
      },
      columns,
      lines,
      totalRow
    );
    if (ok) toast.success("Sales summary downloaded");
    else toast.error("No sales to export for this product.");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/sales/products-taxes")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" />
            {product.name}
            <Badge variant="outline" className="capitalize font-normal">{product.type?.replace("_", " ") || "service"}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {(product as any).sku && (
              <span className="inline-flex items-center gap-1"><Hash className="w-3 h-3" />{(product as any).sku} · </span>
            )}
            {product.description || "No description"}
          </p>
        </div>
        <Button variant="outline" onClick={handleDownloadExcel} disabled={lines.length === 0}>
          <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Download Excel
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Qty Sold</p>
            <p className="text-xl font-bold text-foreground tabular-nums">{totalQty.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Revenue</p>
            <p className="text-xl font-bold text-primary tabular-nums">{formatCurrency(totalRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Invoices</p>
            <p className="text-xl font-bold text-foreground tabular-nums">{invoiceCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Avg Sale Price</p>
            <p className="text-xl font-bold text-foreground tabular-nums">{formatCurrency(avgPrice)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Sales History */}
      <Card>
        <CardContent className="p-0">
          <div className="px-5 pt-5 pb-1 flex items-center gap-2 text-sm font-medium text-foreground">
            <TrendingUp className="w-4 h-4 text-muted-foreground" /> Sales History
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No sales yet</TableCell></TableRow>
              ) : lines.map((l: any) => (
                <TableRow
                  key={l.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => navigate(`/sales/invoices/${l.invoices.id}/edit`)}
                >
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5 text-muted-foreground" />{l.invoices.invoice_number}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(l.invoices.issue_date)}</TableCell>
                  <TableCell className="text-muted-foreground">{l.invoices.customers?.name || "—"}</TableCell>
                  <TableCell>
                    <Badge className={`capitalize ${statusColors[l.invoices.status] || "bg-muted text-muted-foreground"}`}>
                      {l.invoices.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{Number(l.quantity).toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(Number(l.unit_price))}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(Number(l.total))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
