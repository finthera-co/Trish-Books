import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Download, Users, Building2, Search, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { format } from "date-fns";

const fmt = (n: number) => {
  const abs = Math.abs(n);
  const str = `LKR ${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `(${str})` : str;
};

interface SubLedgerEntry {
  id: string;
  date: string;
  reference: string;
  description: string;
  amount: number;
  balance: number;
}

interface CustomerBalance {
  id: string;
  name: string;
  email: string | null;
  totalInvoiced: number;
  totalPaid: number;
  balance: number;
  entries: SubLedgerEntry[];
}

interface VendorBalance {
  id: string;
  name: string;
  email: string | null;
  totalVouchers: number;
  totalPaid: number;
  balance: number;
  entries: SubLedgerEntry[];
}

export function ARSubledger() {
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerBalance | null>(null);

  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ["ar_invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_id, total_amount, status, issue_date, due_date, customers(id, name, email)")
        .order("issue_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: payments } = useQuery({
    queryKey: ["ar_payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments_received")
        .select("id, invoice_id, amount, payment_date, payment_method, reference");
      if (error) throw error;
      return data;
    },
  });

  const customerBalances: CustomerBalance[] = useMemo(() => {
    if (!invoices) return [];

    const map = new Map<string, CustomerBalance>();

    invoices.forEach((inv: any) => {
      const customer = inv.customers;
      if (!customer) return;

      if (!map.has(customer.id)) {
        map.set(customer.id, {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          totalInvoiced: 0,
          totalPaid: 0,
          balance: 0,
          entries: [],
        });
      }

      const cb = map.get(customer.id)!;
      const amount = Number(inv.total_amount);
      cb.totalInvoiced += amount;

      cb.entries.push({
        id: inv.id,
        date: inv.issue_date,
        reference: inv.invoice_number,
        description: `Invoice ${inv.invoice_number}`,
        amount: amount,
        balance: 0,
      });
    });

    // Add payments
    if (payments) {
      payments.forEach(pmt => {
        const inv = invoices?.find((i: any) => i.id === pmt.invoice_id);
        if (!inv?.customers) return;
        const cb = map.get(inv.customers.id);
        if (!cb) return;
        const amount = Number(pmt.amount);
        cb.totalPaid += amount;
        cb.entries.push({
          id: pmt.id,
          date: typeof pmt.payment_date === 'string' ? pmt.payment_date.slice(0, 10) : pmt.payment_date,
          reference: pmt.reference || "",
          description: `Payment received (${pmt.payment_method || "N/A"})`,
          amount: -amount,
          balance: 0,
        });
      });
    }

    // Calculate balances and sort entries
    map.forEach(cb => {
      cb.balance = cb.totalInvoiced - cb.totalPaid;
      cb.entries.sort((a, b) => a.date.localeCompare(b.date));
      let running = 0;
      cb.entries.forEach(e => {
        running += e.amount;
        e.balance = running;
      });
    });

    return Array.from(map.values()).sort((a, b) => b.balance - a.balance);
  }, [invoices, payments]);

  const filtered = customerBalances.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalBalance = filtered.reduce((s, c) => s + c.balance, 0);

  const handleExport = () => {
    const header = ["Customer", "Email", "Total Invoiced", "Total Paid", "Balance"];
    const rows = filtered.map(c => [c.name, c.email || "", c.totalInvoiced.toFixed(2), c.totalPaid.toFixed(2), c.balance.toFixed(2)]);
    rows.push(["TOTAL", "", filtered.reduce((s, c) => s + c.totalInvoiced, 0).toFixed(2), filtered.reduce((s, c) => s + c.totalPaid, 0).toFixed(2), totalBalance.toFixed(2)]);
    const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ar-subledger-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Customers</p>
          <p className="text-xl font-bold text-foreground mt-1">{customerBalances.length}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Invoiced</p>
          <p className="text-xl font-bold text-foreground mt-1">{fmt(customerBalances.reduce((s, c) => s + c.totalInvoiced, 0))}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Received</p>
          <p className="text-xl font-bold text-success mt-1">{fmt(customerBalances.reduce((s, c) => s + c.totalPaid, 0))}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Outstanding</p>
          <p className={`text-xl font-bold mt-1 ${totalBalance > 0 ? "text-warning" : "text-success"}`}>{fmt(totalBalance)}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search customers..."
            className="w-full text-sm border border-input rounded-lg pl-9 pr-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground" />
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
          <Download className="w-4 h-4 mr-1" /> Export
        </Button>
      </div>

      {/* Table */}
      <div className="stat-card">
        <div className="text-center mb-4">
          <h2 className="text-lg font-bold text-foreground">Accounts Receivable Subsidiary Ledger</h2>
          <p className="text-xs text-muted-foreground">Customer balances as of {format(new Date(), "MMM d, yyyy")}</p>
        </div>

        {invoicesLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No customer balances found</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Email</th>
                <th className="text-right w-36">Invoiced</th>
                <th className="text-right w-36">Paid</th>
                <th className="text-right w-36">Balance</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-muted/20">
                  <td className="font-medium text-foreground">{c.name}</td>
                  <td className="text-muted-foreground text-sm">{c.email || "—"}</td>
                  <td className="text-right font-mono tabular-nums">{fmt(c.totalInvoiced)}</td>
                  <td className="text-right font-mono tabular-nums text-success">{fmt(c.totalPaid)}</td>
                  <td className={`text-right font-mono tabular-nums font-semibold ${c.balance > 0 ? "text-warning" : "text-success"}`}>
                    {fmt(c.balance)}
                  </td>
                  <td>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedCustomer(c)}>
                      <Eye className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold border-t-2 border-foreground/20">
                <td colSpan={2}>Totals</td>
                <td className="text-right font-mono tabular-nums">{fmt(filtered.reduce((s, c) => s + c.totalInvoiced, 0))}</td>
                <td className="text-right font-mono tabular-nums">{fmt(filtered.reduce((s, c) => s + c.totalPaid, 0))}</td>
                <td className="text-right font-mono tabular-nums">{fmt(totalBalance)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedCustomer} onOpenChange={() => setSelectedCustomer(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedCustomer?.name} — AR Detail</DialogTitle>
            <DialogDescription>Transaction history for this customer</DialogDescription>
          </DialogHeader>
          {selectedCustomer && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted/50 rounded-lg px-3 py-2 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">Invoiced</p>
                  <p className="font-bold text-foreground">{fmt(selectedCustomer.totalInvoiced)}</p>
                </div>
                <div className="bg-muted/50 rounded-lg px-3 py-2 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">Paid</p>
                  <p className="font-bold text-success">{fmt(selectedCustomer.totalPaid)}</p>
                </div>
                <div className="bg-muted/50 rounded-lg px-3 py-2 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">Balance</p>
                  <p className={`font-bold ${selectedCustomer.balance > 0 ? "text-warning" : "text-success"}`}>{fmt(selectedCustomer.balance)}</p>
                </div>
              </div>
              <table className="data-table text-sm">
                <thead>
                  <tr>
                    <th className="w-24">Date</th>
                    <th>Description</th>
                    <th className="w-28">Reference</th>
                    <th className="text-right w-32">Amount</th>
                    <th className="text-right w-32">Running Bal.</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedCustomer.entries.map((e, i) => (
                    <tr key={i}>
                      <td className="text-muted-foreground tabular-nums">{e.date}</td>
                      <td className="text-foreground">{e.description}</td>
                      <td className="font-mono text-xs text-muted-foreground">{e.reference || "—"}</td>
                      <td className={`text-right font-mono tabular-nums ${e.amount < 0 ? "text-success" : "text-foreground"}`}>
                        {e.amount < 0 ? `(${fmt(Math.abs(e.amount))})` : fmt(e.amount)}
                      </td>
                      <td className="text-right font-mono tabular-nums font-semibold text-foreground">{fmt(e.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function APSubledger() {
  const [search, setSearch] = useState("");
  const [selectedVendor, setSelectedVendor] = useState<VendorBalance | null>(null);

  const { data: vouchers, isLoading } = useQuery({
    queryKey: ["ap_vouchers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_vouchers")
        .select("id, voucher_number, payee_id, total_amount, status, payment_date, memo, customers(id, name, email)")
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const vendorBalances: VendorBalance[] = useMemo(() => {
    if (!vouchers) return [];

    const map = new Map<string, VendorBalance>();

    vouchers.forEach((v: any) => {
      const vendor = v.customers;
      if (!vendor) return;

      if (!map.has(vendor.id)) {
        map.set(vendor.id, {
          id: vendor.id,
          name: vendor.name,
          email: vendor.email,
          totalVouchers: 0,
          totalPaid: 0,
          balance: 0,
          entries: [],
        });
      }

      const vb = map.get(vendor.id)!;
      const amount = Number(v.total_amount);

      if (v.status === "approved" || v.status === "posted") {
        vb.totalPaid += amount;
        vb.entries.push({
          id: v.id,
          date: v.payment_date,
          reference: v.voucher_number,
          description: `${v.voucher_number} — ${v.memo || "Payment"}`,
          amount: -amount,
          balance: 0,
        });
      } else {
        vb.totalVouchers += amount;
        vb.entries.push({
          id: v.id,
          date: v.payment_date,
          reference: v.voucher_number,
          description: `${v.voucher_number} — ${v.memo || "Pending"} (${v.status})`,
          amount: amount,
          balance: 0,
        });
      }
    });

    map.forEach(vb => {
      vb.balance = vb.totalVouchers - vb.totalPaid;
      vb.entries.sort((a, b) => a.date.localeCompare(b.date));
      let running = 0;
      vb.entries.forEach(e => {
        running += e.amount;
        e.balance = running;
      });
    });

    return Array.from(map.values()).sort((a, b) => b.balance - a.balance);
  }, [vouchers]);

  const filtered = vendorBalances.filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalBalance = filtered.reduce((s, v) => s + v.balance, 0);

  const handleExport = () => {
    const header = ["Vendor", "Email", "Total Vouchers", "Total Paid", "Balance"];
    const rows = filtered.map(v => [v.name, v.email || "", v.totalVouchers.toFixed(2), v.totalPaid.toFixed(2), v.balance.toFixed(2)]);
    const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ap-subledger-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Vendors</p>
          <p className="text-xl font-bold text-foreground mt-1">{vendorBalances.length}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Paid</p>
          <p className="text-xl font-bold text-success mt-1">{fmt(vendorBalances.reduce((s, v) => s + v.totalPaid, 0))}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Outstanding Payables</p>
          <p className={`text-xl font-bold mt-1 ${totalBalance > 0 ? "text-warning" : "text-success"}`}>{fmt(totalBalance)}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search vendors..."
            className="w-full text-sm border border-input rounded-lg pl-9 pr-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground" />
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
          <Download className="w-4 h-4 mr-1" /> Export
        </Button>
      </div>

      {/* Table */}
      <div className="stat-card">
        <div className="text-center mb-4">
          <h2 className="text-lg font-bold text-foreground">Accounts Payable Subsidiary Ledger</h2>
          <p className="text-xs text-muted-foreground">Vendor balances as of {format(new Date(), "MMM d, yyyy")}</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Building2 className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No vendor balances found</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Email</th>
                <th className="text-right w-36">Total Vouchers</th>
                <th className="text-right w-36">Total Paid</th>
                <th className="text-right w-36">Balance</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(v => (
                <tr key={v.id} className="hover:bg-muted/20">
                  <td className="font-medium text-foreground">{v.name}</td>
                  <td className="text-muted-foreground text-sm">{v.email || "—"}</td>
                  <td className="text-right font-mono tabular-nums">{fmt(v.totalVouchers)}</td>
                  <td className="text-right font-mono tabular-nums text-success">{fmt(v.totalPaid)}</td>
                  <td className={`text-right font-mono tabular-nums font-semibold ${v.balance > 0 ? "text-warning" : "text-success"}`}>
                    {fmt(v.balance)}
                  </td>
                  <td>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedVendor(v)}>
                      <Eye className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold border-t-2 border-foreground/20">
                <td colSpan={2}>Totals</td>
                <td className="text-right font-mono tabular-nums">{fmt(filtered.reduce((s, v) => s + v.totalVouchers, 0))}</td>
                <td className="text-right font-mono tabular-nums">{fmt(filtered.reduce((s, v) => s + v.totalPaid, 0))}</td>
                <td className="text-right font-mono tabular-nums">{fmt(totalBalance)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedVendor} onOpenChange={() => setSelectedVendor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedVendor?.name} — AP Detail</DialogTitle>
            <DialogDescription>Transaction history for this vendor</DialogDescription>
          </DialogHeader>
          {selectedVendor && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted/50 rounded-lg px-3 py-2 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">Total Vouchers</p>
                  <p className="font-bold text-foreground">{fmt(selectedVendor.totalVouchers)}</p>
                </div>
                <div className="bg-muted/50 rounded-lg px-3 py-2 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">Paid</p>
                  <p className="font-bold text-success">{fmt(selectedVendor.totalPaid)}</p>
                </div>
                <div className="bg-muted/50 rounded-lg px-3 py-2 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">Balance</p>
                  <p className={`font-bold ${selectedVendor.balance > 0 ? "text-warning" : "text-success"}`}>{fmt(selectedVendor.balance)}</p>
                </div>
              </div>
              <table className="data-table text-sm">
                <thead>
                  <tr>
                    <th className="w-24">Date</th>
                    <th>Description</th>
                    <th className="w-28">Reference</th>
                    <th className="text-right w-32">Amount</th>
                    <th className="text-right w-32">Running Bal.</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedVendor.entries.map((e, i) => (
                    <tr key={i}>
                      <td className="text-muted-foreground tabular-nums">{e.date}</td>
                      <td className="text-foreground">{e.description}</td>
                      <td className="font-mono text-xs text-muted-foreground">{e.reference || "—"}</td>
                      <td className={`text-right font-mono tabular-nums ${e.amount < 0 ? "text-success" : "text-foreground"}`}>
                        {e.amount < 0 ? `(${fmt(Math.abs(e.amount))})` : fmt(e.amount)}
                      </td>
                      <td className="text-right font-mono tabular-nums font-semibold text-foreground">{fmt(e.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
