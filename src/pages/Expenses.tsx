import { Plus, Search, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useExpenses, useCreateExpense, useUpdateExpense, useApproveExpense, useExpenseCategories, useCreateExpenseCategory, useUpdateExpenseCategory } from "@/hooks/useData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useMyPermissions } from "@/hooks/usePermissions";
import AccountSelector from "@/components/shared/AccountSelector";

const statusColors: Record<string, string> = {
  approved: "bg-success/10 text-success",
  pending: "bg-warning/10 text-warning",
  rejected: "bg-destructive/10 text-destructive",
};

export default function Expenses() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split("T")[0]);
  const [newCatName, setNewCatName] = useState("");
  const [newCatAccountId, setNewCatAccountId] = useState("");

  const { data: expenses, isLoading } = useExpenses();
  const { data: categories } = useExpenseCategories();
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const approveExpense = useApproveExpense();
  const createCategory = useCreateExpenseCategory();
  const updateCategory = useUpdateExpenseCategory();
  const { isCompanyAdmin } = useAuth();
  const { canEdit: canEditExpenses } = useMyPermissions();

  const handleCreateCategory = async () => {
    const cat = await createCategory.mutateAsync({ name: newCatName, account_id: newCatAccountId });
    setCategoryId(cat.id);
    setCatOpen(false);
    setNewCatName("");
    setNewCatAccountId("");
  };

  const filtered = expenses?.filter((e) =>
    (e.description || "").toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleCreate = async () => {
    await createExpense.mutateAsync({
      amount,
      description,
      category_id: categoryId,
      payment_account_id: paymentAccountId,
      expense_date: expenseDate,
    });
    setOpen(false);
    setAmount(0);
    setDescription("");
    setCategoryId("");
    setPaymentAccountId("");
  };

  const handleApprove = (id: string) => {
    approveExpense.mutate(id);
  };

  const handleReject = (id: string) => {
    updateExpense.mutate({ id, status: "rejected" });
  };

  const totalAll = expenses?.reduce((s, e) => s + Number(e.amount), 0) || 0;
  const totalApproved = expenses?.filter(e => e.status === "approved").reduce((s, e) => s + Number(e.amount), 0) || 0;
  const totalPending = expenses?.filter(e => e.status === "pending").reduce((s, e) => s + Number(e.amount), 0) || 0;
  const totalRejected = expenses?.filter(e => e.status === "rejected").reduce((s, e) => s + Number(e.amount), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-description">Track and approve expense submissions</p>
        </div>
        {canEditExpenses("expenses") && <div className="flex gap-2">
        <Dialog open={manageOpen} onOpenChange={setManageOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">Manage Categories</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Expense Categories</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-4 max-h-[70vh] overflow-y-auto">
              <p className="text-xs text-muted-foreground">
                Each category must map to a GL expense account. Approving an expense posts a debit to this account.
              </p>
              {categories?.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No categories yet.</p>
              )}
              {categories?.map((c) => (
                <div key={c.id} className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{c.name}</p>
                    {!c.account_id && <p className="text-xs text-destructive">No account mapped — expenses can't be approved</p>}
                  </div>
                  <div className="w-1/2">
                    <AccountSelector
                      value={c.account_id}
                      onChange={(v) => updateCategory.mutate({ id: c.id, account_id: v || null })}
                      types={["Expense", "Other Expense", "Cost of Goods Sold"]}
                      placeholder="Map account…"
                    />
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" />Submit Expense</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Submit Expense</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Amount</label>
                  <input type="number" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
                <div>
                  <label className="text-sm font-medium">Date</label>
                  <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Category *</label>
                <div className="flex gap-2 mt-1">
                  <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                    className="flex-1 text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                    <option value="">Select category...</option>
                    {categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <Dialog open={catOpen} onOpenChange={setCatOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">New</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>New Category</DialogTitle></DialogHeader>
                      <div className="space-y-4 pt-4">
                        <div>
                          <label className="text-sm font-medium">Category Name</label>
                          <input type="text" value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
                            className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="Travel" />
                        </div>
                        <div>
                          <label className="text-sm font-medium">Expense Account *</label>
                          <div className="mt-1">
                            <AccountSelector
                              value={newCatAccountId}
                              onChange={(v) => setNewCatAccountId(v)}
                              types={["Expense", "Other Expense", "Cost of Goods Sold"]}
                              placeholder="Search expense account…"
                            />
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">Approved expenses post here as a debit.</p>
                        </div>
                        <Button onClick={handleCreateCategory} disabled={!newCatName || !newCatAccountId} className="w-full">Create Category</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Paid Through *</label>
                <div className="mt-1">
                  <AccountSelector
                    value={paymentAccountId}
                    onChange={(v) => setPaymentAccountId(v)}
                    types={["Asset"]}
                    placeholder="Search cash / bank account…"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">Cash or bank account the money was paid from.</p>
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="Office supplies" />
              </div>
              <Button onClick={handleCreate} disabled={!amount || !categoryId || !paymentAccountId || createExpense.isPending} className="w-full">
                {createExpense.isPending ? "Submitting..." : "Submit Expense"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Expenses</p>
          <p className="text-xl font-bold text-foreground mt-1">LKR {totalAll.toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Approved</p>
          <p className="text-xl font-bold text-success mt-1">LKR {totalApproved.toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending</p>
          <p className="text-xl font-bold text-warning mt-1">LKR {totalPending.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">{expenses?.filter(e => e.status === "pending").length || 0} items</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Rejected</p>
          <p className="text-xl font-bold text-destructive mt-1">LKR {totalRejected.toLocaleString()}</p>
        </div>
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search expenses..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>
        
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No expenses found</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Description</th><th>Category</th><th>Date</th><th>Status</th><th className="text-right">Amount</th><th></th></tr></thead>
            <tbody>
              {filtered.map((exp) => (
                <tr key={exp.id}>
                  <td className="font-medium text-foreground">{exp.description || "-"}</td>
                  <td>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                      {(exp.expense_categories as any)?.name || "Uncategorized"}
                    </span>
                  </td>
                  <td className="text-muted-foreground">{exp.expense_date}</td>
                  <td><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[exp.status] || ""}`}>{exp.status}</span></td>
                  <td className="text-right font-medium text-foreground">LKR {Number(exp.amount).toLocaleString()}</td>
                  <td>
                    {isCompanyAdmin && exp.status === "pending" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-1 rounded hover:bg-accent"><MoreHorizontal className="w-4 h-4 text-muted-foreground" /></button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => handleApprove(exp.id)}>Approve &amp; Post</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleReject(exp.id)}>Reject</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
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
