import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAssetCategories, useDeleteAssetCategory } from "@/hooks/useAssetCategories";
import { useAccounts } from "@/hooks/useData";
import AssetCategoryDialog from "@/components/asset-categories/AssetCategoryDialog";

export default function AssetCategories() {
  const { data: categories, isLoading } = useAssetCategories();
  const { data: accounts } = useAccounts();
  const deleteCat = useDeleteAssetCategory();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const accountMap = new Map((accounts ?? []).map((a: any) => [a.id, a]));
  const acctName = (id: string | null) => id ? accountMap.get(id)?.account_name ?? "—" : "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Asset Categories</h1>
          <p className="text-sm text-muted-foreground">
            Configure accounting rules for each asset class. All account mappings are resolved from here.
          </p>
        </div>
        <Button onClick={() => { setEditingId(null); setDialogOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" /> New Category
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Asset Account</TableHead>
                <TableHead>Accum. Depr. Account</TableHead>
                <TableHead>Depr. Expense Account</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Default Life</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
              ) : !categories?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No categories. Create one to start adding assets.</TableCell></TableRow>
              ) : (
                categories.map((cat: any) => (
                  <TableRow key={cat.id}>
                    <TableCell className="font-medium">{cat.name}</TableCell>
                    <TableCell className="text-sm">{acctName(cat.asset_account_id)}</TableCell>
                    <TableCell className="text-sm">{acctName(cat.accumulated_depreciation_account_id)}</TableCell>
                    <TableCell className="text-sm">{acctName(cat.depreciation_expense_account_id)}</TableCell>
                    <TableCell><Badge variant="outline">{cat.depreciation_method}</Badge></TableCell>
                    <TableCell>{cat.default_useful_life_months} mo</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => { setEditingId(cat.id); setDialogOpen(true); }}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteCat.mutate(cat.id)} disabled={deleteCat.isPending}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AssetCategoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingId={editingId}
      />
    </div>
  );
}
