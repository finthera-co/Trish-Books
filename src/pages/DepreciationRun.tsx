import { useState, useMemo } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Play, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { useRunDepreciation, useFixedAssets } from "@/hooks/useFixedAssets";
import { useAccounts } from "@/hooks/useData";
import { formatCurrency } from "@/lib/currency";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Recursive child collection
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

export default function DepreciationRun() {
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const runDep = useRunDepreciation();
  const { data: assets } = useFixedAssets();
  const { data: accounts } = useAccounts();
  const [result, setResult] = useState<{ processed: number; skipped: number; message?: string; errors?: string[]; journal_entry_ids?: string[] } | null>(null);
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get("account_id");

  const accountMap = useMemo(() => {
    const map = new Map<string, any>();
    (accounts as any[] || []).forEach(a => map.set(a.id, a));
    return map;
  }, [accounts]);

  // Recursive filtering: include accountId + all descendant depreciation account IDs
  const activeAssets = useMemo(() => {
    const all = assets?.filter(a => a.status === "active") ?? [];
    if (!accountId) return all;
    const ids = new Set([accountId, ...getChildAccountIds(accountId, accounts as any[] || [])]);
    return all.filter((a: any) => ids.has(a.depreciation_account_id));
  }, [assets, accountId, accounts]);

  const breadcrumbChain = useMemo(() => {
    if (!accountId) return [];
    return buildBreadcrumbChain(accountId, accountMap);
  }, [accountId, accountMap]);

  const categoryName = accountId ? accountMap.get(accountId)?.account_name : null;

  const handleRun = async () => {
    const res = await runDep.mutateAsync(period);
    setResult(res);
  };

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
                <Link to="/assets/depreciation">Depreciation</Link>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>Depreciation</BreadcrumbPage>
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
                      <Link to={`/assets/depreciation?account_id=${crumb.id}`}>{crumb.name}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </span>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Run Depreciation</h1>
        <p className="text-sm text-muted-foreground">
          {categoryName
            ? `Showing assets under: ${categoryName}`
            : "Process monthly depreciation for all active assets"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Depreciation Period</CardTitle>
          <CardDescription>Select the month to process depreciation for</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <div>
              <label className="text-sm font-medium">Period (YYYY-MM)</label>
              <Input
                type="month"
                value={period}
                onChange={e => setPeriod(e.target.value)}
                className="w-48"
              />
            </div>
            <Button onClick={handleRun} disabled={runDep.isPending || !period}>
              <Play className="w-4 h-4 mr-2" />
              {runDep.isPending ? "Processing..." : "Run Depreciation"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="w-6 h-6 text-primary" />
              <h3 className="text-lg font-semibold">Depreciation Run Complete</h3>
            </div>
            {result.message && (
              <p className="text-sm text-muted-foreground mb-4">{result.message}</p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 rounded-lg bg-background">
                <p className="text-3xl font-bold text-primary">{result.processed}</p>
                <p className="text-sm text-muted-foreground">Assets Processed</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-background">
                <p className="text-3xl font-bold text-muted-foreground">{result.skipped}</p>
                <p className="text-sm text-muted-foreground">Assets Skipped</p>
              </div>
            </div>
            {result.journal_entry_ids && result.journal_entry_ids.length > 0 && (
              <p className="text-xs text-muted-foreground mt-3">
                {result.journal_entry_ids.length} journal {result.journal_entry_ids.length === 1 ? 'entry' : 'entries'} created
              </p>
            )}
            {result.errors && result.errors.length > 0 && (
              <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-destructive" />
                  <span className="text-sm font-medium text-destructive">Errors</span>
                </div>
                <ul className="text-xs text-destructive space-y-1">
                  {result.errors.map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Active Assets Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Assets ({activeAssets.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Accum. Dep.</TableHead>
                <TableHead className="text-right">NBV</TableHead>
                <TableHead>Method</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeAssets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="w-5 h-5 mx-auto mb-2" />
                    No active assets to depreciate
                  </TableCell>
                </TableRow>
              ) : (
                activeAssets.map(asset => (
                  <TableRow key={asset.id}>
                    <TableCell className="font-medium">{asset.asset_name}</TableCell>
                    <TableCell className="text-right">{formatCurrency(asset.cost)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(asset.accumulated_depreciation)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(asset.cost - (asset.accumulated_depreciation ?? 0))}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{(asset as any).depreciation_method ?? "straight_line"}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
