import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AccountCategory } from "@/hooks/useAccountCategories";

const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Revenue", "Expense"];

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  parent_account_id: string | null;
  category_id: string | null;
  is_active: boolean;
}

interface AccountFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    account_name: string;
    account_code: string;
    account_type: string;
    parent_account_id?: string;
    category_id?: string;
  }) => Promise<void>;
  accounts: Account[];
  categories: AccountCategory[];
  isPending: boolean;
  editAccount?: Account | null;
}

export default function AccountForm({
  open,
  onOpenChange,
  onSubmit,
  accounts,
  categories,
  isPending,
  editAccount,
}: AccountFormProps) {
  const [accountName, setAccountName] = useState(editAccount?.account_name || "");
  const [accountCode, setAccountCode] = useState(editAccount?.account_code || "");
  const [accountType, setAccountType] = useState(editAccount?.account_type || "Asset");
  const [parentId, setParentId] = useState(editAccount?.parent_account_id || "");
  const [categoryId, setCategoryId] = useState(editAccount?.category_id || "");

  const filteredCategories = categories.filter(c => c.account_type === accountType);

  const handleSubmit = async () => {
    await onSubmit({
      account_name: accountName,
      account_code: accountCode,
      account_type: accountType,
      parent_account_id: parentId || undefined,
      category_id: categoryId || undefined,
    });
    setAccountName("");
    setAccountCode("");
    setAccountType("Asset");
    setParentId("");
    setCategoryId("");
  };

  const inputClass = "mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editAccount ? "Edit Account" : "Create New Account"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Account Code</label>
              <input
                type="text"
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value)}
                className={inputClass}
                placeholder="1100"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Account Type</label>
              <select
                value={accountType}
                onChange={(e) => {
                  setAccountType(e.target.value);
                  setCategoryId("");
                }}
                className={inputClass}
              >
                {ACCOUNT_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Account Name</label>
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className={inputClass}
              placeholder="Cash & Bank"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={inputClass}
            >
              <option value="">None</option>
              {filteredCategories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Parent Account (optional)</label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className={inputClass}
            >
              <option value="">None (top-level)</option>
              {accounts
                ?.filter(a => a.id !== editAccount?.id)
                .map(a => (
                  <option key={a.id} value={a.id}>
                    {a.account_code} — {a.account_name}
                  </option>
                ))}
            </select>
          </div>
          <div className="bg-muted/50 rounded-lg px-3 py-2 text-xs text-muted-foreground">
            Normal balance:{" "}
            <strong>
              {["Asset", "Expense", "COGS"].includes(accountType) ? "Debit" : "Credit"}
            </strong>
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!accountName || !accountCode || isPending}
            className="w-full"
          >
            {isPending ? "Saving..." : editAccount ? "Update Account" : "Create Account"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
