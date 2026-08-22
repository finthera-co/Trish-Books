import { useMemo, useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { useAccountCategories } from "@/hooks/useAccountCategories";
import { useUpdateAccount } from "@/hooks/useData";
import { flattenAccountTree, canReclassifyParent, type MappableAccount } from "@/lib/accountMappingEngine";

interface MoveAccountAccount extends MappableAccount {
  id: string;
  account_code: string;
  account_name: string;
  category_id: string | null;
}

interface MoveAccountDialogProps {
  account: MoveAccountAccount | null;
  accounts: MoveAccountAccount[];
  accountsMap: Map<string, MappableAccount>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TOP_LEVEL = "__top_level__";

export default function MoveAccountDialog({ account, accounts, accountsMap, open, onOpenChange }: MoveAccountDialogProps) {
  const { data: categories } = useAccountCategories();
  const updateAccount = useUpdateAccount();

  const [parentId, setParentId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");

  useEffect(() => {
    if (!open || !account) return;
    setParentId(account.parent_account_id || TOP_LEVEL);
    setCategoryId(account.category_id || "");
  }, [open, account?.id]);

  const parentOptions = useMemo(() => {
    if (!account) return [];
    return flattenAccountTree(accounts, { accountType: account.account_type, excludeSubtreeOf: account.id })
      .filter(({ account: a }) => a.id !== account.id);
  }, [accounts, account]);

  const categoryOptions = useMemo(
    () => (categories ?? []).filter((c) => c.account_type === account?.account_type),
    [categories, account?.account_type]
  );

  const newParent = useMemo(() => {
    if (!account) return null;
    return parentId === TOP_LEVEL || !parentId ? null : accountsMap.get(parentId) ?? null;
  }, [parentId, accountsMap, account]);

  const validation = useMemo<{ allowed: boolean; reason?: string }>(() => {
    if (!account) return { allowed: true };
    return canReclassifyParent(account, newParent, accountsMap);
  }, [account, newParent, accountsMap]);

  const hasChanges = account && (
    (parentId === TOP_LEVEL ? null : parentId || null) !== (account.parent_account_id || null) ||
    (categoryId || null) !== (account.category_id || null)
  );

  const handleSubmit = async () => {
    if (!account || !validation.allowed) return;
    await updateAccount.mutateAsync({
      id: account.id,
      parent_account_id: parentId === TOP_LEVEL ? null : parentId || null,
      category_id: categoryId || null,
    });
    onOpenChange(false);
  };

  if (!account) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move Account</DialogTitle>
          <DialogDescription>
            Reclassify {account.account_code} — {account.account_name} within the chart of accounts.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-sm font-medium">New Parent Account</label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              <option value={TOP_LEVEL}>— Move to top level —</option>
              {parentOptions.map(({ account: a, depth }) => (
                <option key={a.id} value={a.id}>
                  {"  ".repeat(depth)}{depth > 0 ? "└ " : ""}{a.account_code} — {a.account_name}
                </option>
              ))}
            </select>
            {!validation.allowed && (
              <p className="text-[10px] text-destructive mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {validation.reason}
              </p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium">New Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              <option value="">— No category —</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!validation.allowed || !hasChanges || updateAccount.isPending}
            className="w-full"
          >
            {updateAccount.isPending ? "Moving…" : "Move Account"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
