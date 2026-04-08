import { useState, useMemo } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Plus, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { useFixedAssets } from "@/hooks/useFixedAssets";
import { useAccounts } from "@/hooks/useData";
import { formatCurrency } from "@/lib/currency";

export default function AssetRegister() {
  const { data: assets, isLoading } = useFixedAssets();
  const { data: accounts } = useAccounts();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get("account_id");

  // Build account lookup for category names
  const accountMap = useMemo(() => {
    const map = new Map<string, string>();
    accounts?.forEach((a: any) => map.set(a.id, a.account_name));
    return map;
  }, [accounts]);

  const categoryName = accountId ? accountMap.get(accountId) : null;

  // Filter assets by category account if specified
  const filteredAssets = useMemo(() => {
    if (!assets) return [];
    if (!accountId) return assets;
    return assets.filter((a: any) => a.asset_account_id === accountId);
  }, [assets, accountId]);

  const totalCost = filteredAssets.reduce((s, a: any) => s + (a.cost || 0), 0);
  const totalNBV = filteredAssets.reduce((s, a: any) => s + (a.net_book_value ?? a.cost - (a.accumulated_depreciation ?? 0)), 0);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/accounting/accounts">Chart of Accounts</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          {accountId && categoryName ? (
            <>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/assets/register">Fixed Assets</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{categoryName}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : (
            <BreadcrumbItem>
              <BreadcrumbPage>Fixed Assets</BreadcrumbPage>
            </BreadcrumbItem>
          )}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fixed Asset Register</h1>
          {categoryName ? (
            <p className="text-sm text-muted-foreground">
              Category: <span className="font-medium text-foreground">{categoryName}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Track and manage company assets</p>
          )}
        </div>
        <Button onClick={() => navigate("/assets/new")}>
          <Plus className="w-4 h-4 mr-2" /> Add Asset
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Assets</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{filteredAssets.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Cost</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatCurrency(totalCost)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Net Book Value</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatCurrency(totalNBV)}</p></CardContent>
        </Card>
      </div>

      {/* Asset Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Accum. Depreciation</TableHead>
                <TableHead className="text-right">Net Book Value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
              ) : !filteredAssets.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {accountId
                      ? "No assets in this category. Click \"Add Asset\" to get started."
                      : "No assets found. Click \"Add Asset\" to get started."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredAssets.map((asset: any) => {
                  const nbv = asset.net_book_value ?? (asset.cost - (asset.accumulated_depreciation ?? 0));
                  const catName = asset.asset_account_id ? accountMap.get(asset.asset_account_id) : null;
                  return (
                    <TableRow key={asset.id} className="cursor-pointer" onClick={() => navigate(`/assets/${asset.id}`)}>
                      <TableCell className="font-medium">{asset.asset_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{catName ?? "—"}</TableCell>
                      <TableCell className="text-right">{formatCurrency(asset.cost)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(asset.accumulated_depreciation)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(nbv)}</TableCell>
                      <TableCell>
                        <Badge variant={asset.status === "active" ? "default" : "secondary"}>
                          {asset.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); navigate(`/assets/${asset.id}`); }}>
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
