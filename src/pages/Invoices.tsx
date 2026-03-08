import { Plus, Search, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useInvoices, useCreateInvoice, useUpdateInvoice, useCustomers, useCreateCustomer } from "@/hooks/useData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const statusColors: Record<string, string> = {
  paid: "bg-success/10 text-success",
  sent: "bg-info/10 text-info",
  overdue: "bg-destructive/10 text-destructive",
  draft: "bg-muted text-muted-foreground",
};

export default function Invoices() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [totalAmount, setTotalAmount] = useState(0);
  
  // New customer form
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  const { data: invoices, isLoading } = useInvoices();
  const { data: customers } = useCustomers();
  const createInvoice = useCreateInvoice();
  const updateInvoice = useUpdateInvoice();
  const createCustomer = useCreateCustomer();

  const filtered = invoices?.filter((i) =>
    i.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
    (i.customers as any)?.name?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleCreate = async () => {
    await createInvoice.mutateAsync({
      customer_id: customerId,
      invoice_number: invoiceNumber,
      issue_date: issueDate,
      due_date: dueDate,
      total_amount: totalAmount,
    });
    setOpen(false);
    setCustomerId("");
    setInvoiceNumber("");
    setTotalAmount(0);
  };

  const handleCreateCustomer = async () => {
    const customer = await createCustomer.mutateAsync({ name: customerName, email: customerEmail });
    setCustomerId(customer.id);
    setCustomerOpen(false);
    setCustomerName("");
    setCustomerEmail("");
  };

  const handleStatusChange = (id: string, status: string) => {
    updateInvoice.mutate({ id, status });
  };

  const stats = {
    outstanding: invoices?.filter(i => i.status === "sent").reduce((s, i) => s + Number(i.total_amount), 0) || 0,
    paid: invoices?.filter(i => i.status === "paid").reduce((s, i) => s + Number(i.total_amount), 0) || 0,
    overdue: invoices?.filter(i => i.status === "overdue").reduce((s, i) => s + Number(i.total_amount), 0) || 0,
    drafts: invoices?.filter(i => i.status === "draft").reduce((s, i) => s + Number(i.total_amount), 0) || 0,
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-description">Create and manage customer invoices</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" />New Invoice</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Invoice</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm font-medium">Customer</label>
                <div className="flex gap-2 mt-1">
                  <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}
                    className="flex-1 text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                    <option value="">Select customer...</option>
                    {customers?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <Dialog open={customerOpen} onOpenChange={setCustomerOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">New</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Add Customer</DialogTitle></DialogHeader>
                      <div className="space-y-4 pt-4">
                        <div>
                          <label className="text-sm font-medium">Name</label>
                          <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                            className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                        </div>
                        <div>
                          <label className="text-sm font-medium">Email</label>
                          <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)}
                            className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                        </div>
                        <Button onClick={handleCreateCustomer} disabled={!customerName} className="w-full">Add Customer</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Invoice Number</label>
                  <input type="text" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="INV-001" />
                </div>
                <div>
                  <label className="text-sm font-medium">Total Amount</label>
                  <input type="number" value={totalAmount || ""} onChange={(e) => setTotalAmount(Number(e.target.value))}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Issue Date</label>
                  <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
                <div>
                  <label className="text-sm font-medium">Due Date</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
              </div>
              <Button onClick={handleCreate} disabled={!customerId || !invoiceNumber || createInvoice.isPending} className="w-full">
                {createInvoice.isPending ? "Creating..." : "Create Invoice"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="stat-card"><p className="text-sm text-muted-foreground">Total Outstanding</p><p className="text-xl font-semibold text-foreground mt-1">${stats.outstanding.toLocaleString()}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Paid This Month</p><p className="text-xl font-semibold text-success mt-1">${stats.paid.toLocaleString()}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Overdue</p><p className="text-xl font-semibold text-destructive mt-1">${stats.overdue.toLocaleString()}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Drafts</p><p className="text-xl font-semibold text-muted-foreground mt-1">${stats.drafts.toLocaleString()}</p></div>
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>
        
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No invoices found</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Due Date</th><th>Status</th><th className="text-right">Amount</th><th></th></tr></thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id}>
                  <td className="font-medium text-foreground">{inv.invoice_number}</td>
                  <td>{(inv.customers as any)?.name || "-"}</td>
                  <td className="text-muted-foreground">{inv.issue_date}</td>
                  <td className="text-muted-foreground">{inv.due_date || "-"}</td>
                  <td><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[inv.status] || ""}`}>{inv.status}</span></td>
                  <td className="text-right font-medium text-foreground">${Number(inv.total_amount).toLocaleString()}</td>
                  <td>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 rounded hover:bg-accent"><MoreHorizontal className="w-4 h-4 text-muted-foreground" /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => handleStatusChange(inv.id, "sent")}>Mark as Sent</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStatusChange(inv.id, "paid")}>Mark as Paid</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStatusChange(inv.id, "overdue")}>Mark as Overdue</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
