import { useState, useMemo } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Plus, Eye, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { useFixedAssets } from "@/hooks/useFixedAssets";
import { useAccounts } from "@/hooks/useData";
import { formatCurrency } from "@/lib/currency";

// ─── Recursive helpers ────────────────────────────────────
function getChildAccountIds(accountId: string, accounts: any[]): string[] {
  const children = accounts.filter(a => a.parent_account_id === accountId);
  return children.reduce<string[]>((acc, child) => {
    return [...acc, child.id, ...getChildAccountIds(child.id, accounts)];
  }, []);
}

function buildBreadcrumbChain(accountId: string, accountMap: Map<string, any>): Array<{ id: string; name: string }> {
  const chain: Array<{ id: string; name: string }> = [];
  let current = accountMap.get(accountId);
  while (current) {
    chain.unshift({ id: current.id, name: current.account_name });
    current = current.parent_account_id ? accountMap.get(current.parent_account_id) : null;
  }
  return chain;
}

export default function AssetRegister() {
  const { data: assets, isLoading } = useFixedAssets();
  const { data: accounts } = useAccounts();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get("account_id");

  // Build account lookup
  const accountMap = useMemo(() => {
    const map = new Map<string, any>();
    (accounts as any[] || []).forEach(a => map.set(a.id, a));
    return map;
  }, [accounts]);

  // Recursive filtering: include accountId + all descendant account IDs
  const filteredAssets = useMemo(() => {
    if (!assets) return [];
    if (!accountId) return assets;
    const ids = new Set([accountId, ...getChildAccountIds(accountId, accounts as any[] || [])]);
    return (assets as any[]).filter(a => ids.has(a.asset_account_id));
  }, [assets, accountId, accounts]);

  // Breadcrumb chain
  const breadcrumbChain = useMemo(() => {
    if (!accountId) return [];
    return buildBreadcrumbChain(accountId, accountMap);
  }, [accountId, accountMap]);

  const categoryName = accountId ? accountMap.get(accountId)?.account_name : null;

  const totalCost = filteredAssets.reduce((s, a: any) => s + (a.cost || 0), 0);
  const totalNBV = filteredAssets.reduce((s, a: any) => s + (a.cost || 0) - (a.accumulated_depreciation ?? 0), 0);

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
          <BreadcrumbItem>
            {accountId ? (
              <BreadcrumbLink asChild>
                <Link to="/assets/register">Fixed Assets</Link>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>Fixed Assets</BreadcrumbPage>
            )}
          </BreadcrumbItem>
          {breadcrumbChain.map((crumb, idx) => {
            const isLast = idx === breadcrumbChain.length - 1;
            return (
              <span key={crumb.id} className="contents">
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {isLast ? (
                    <BreadcrumbPage>{crumb.name}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={`/assets/register?account_id=${crumb.id}`}>{crumb.name}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </span>
            );
          })}
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/reports/financial?report=fixed-asset-schedule")}>
            <BarChart3 className="w-4 h-4 mr-2" />
            Asset Schedule
          </Button>
          <Button onClick={() => navigate("/assets/new")}>
            <Plus className="w-4 h-4 mr-2" /> Add Asset
          </Button>
        </div>
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
                  const nbv = asset.cost - (asset.accumulated_depreciation ?? 0);
                  const catName = asset.asset_account_id ? accountMap.get(asset.asset_account_id)?.account_name : null;
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
