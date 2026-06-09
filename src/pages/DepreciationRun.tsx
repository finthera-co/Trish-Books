import { useState, useMemo } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Play, CheckCircle, AlertCircle, Info, ChevronDown, ChevronUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useRunDepreciation, useFixedAssets } from "@/hooks/useFixedAssets";
import { useAssetCategories } from "@/hooks/useAssetCategories";
import { useAccounts } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

function calcMonthlyAmount(asset: any): number | null {
  const cost = asset.cost ?? 0;
  const salvage = asset.salvage_value ?? 0;
  const life = asset.useful_life_months;
  if (!life || life <= 0) return null;
  return (cost - salvage) / life;
}

export default function DepreciationRun() {
  const { appUser } = useAuth();
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const runDep = useRunDepreciation();
  const { data: assets } = useFixedAssets();
  const { data: accounts } = useAccounts();
  const { data: categories } = useAssetCategories();
  const [result, setResult] = useState<{ processed: number; skipped: number; message?: string; errors?: string[]; journal_entry_ids?: string[] } | null>(null);
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get("account_id");

  const accountMap = useMemo(() => {
    const map = new Map<string, any>();
    (accounts as any[] || []).forEach(a => map.set(a.id, a));
    return map;
  }, [accounts]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, any>();
    (categories ?? []).forEach((c: any) => map.set(c.id, c));
    return map;
  }, [categories]);

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

  const { data: postedThisPeriod } = useQuery({
    queryKey: ["asset_depreciation_period", period, appUser?.tenant_id],
    enabled: !!period && !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_depreciation")
        .select("asset_id")
        .eq("period", period);
      if (error) throw error;
      return (data ?? []) as { asset_id: string }[];
    },
  });

  const postedAssetIds = useMemo(() =>
    new Set(postedThisPeriod?.map(r => r.asset_id) ?? []),
    [postedThisPeriod]
  );

  const pendingAssets = useMemo(() =>
    activeAssets.filter((a: any) => !postedAssetIds.has(a.id)),
    [activeAssets, postedAssetIds]
  );

  const periodAlreadyPosted = activeAssets.length > 0 && pendingAssets.length === 0;

  const handleRun = async () => {
    setErrorsOpen(false);
    const res = await runDep.mutateAsync(period);
    setResult(res);
    if (res.errors?.length) setErrorsOpen(true);
  };

  return (
    <div className="space-y-6">
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
                onChange={e => { setPeriod(e.target.value); setResult(null); }}
                className="w-48"
              />
            </div>
            <Button onClick={handleRun} disabled={runDep.isPending || !period || periodAlreadyPosted}>
              <Play className="w-4 h-4 mr-2" />
              {runDep.isPending ? "Processing..." : "Run Depreciation"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pre-run preview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                Assets Pending for {period}
                {pendingAssets.length > 0 && (
                  <Badge>{pendingAssets.length}</Badge>
                )}
              </CardTitle>
              <CardDescription>Review before running depreciation</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {periodAlreadyPosted ? (
            <div className="flex items-center gap-2 px-6 py-4 text-sm text-muted-foreground">
              <Info className="w-4 h-4 shrink-0" />
              All active assets have already been posted for {period}. Select a different period to run again.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Monthly Amount</TableHead>
                  <TableHead className="text-right">Accumulated to Date</TableHead>
                  <TableHead className="text-right">NBV After Run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingAssets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      <AlertCircle className="w-5 h-5 mx-auto mb-2" />
                      No active assets to depreciate
                    </TableCell>
                  </TableRow>
                ) : (
                  pendingAssets.map((asset: any) => {
                    const monthly = calcMonthlyAmount(asset);
                    const accumDep = asset.accumulated_depreciation ?? 0;
                    const nbvAfter = asset.cost - accumDep - (monthly ?? 0);
                    const catName = asset.category_id ? categoryMap.get(asset.category_id)?.name : null;
                    return (
                      <TableRow key={asset.id}>
                        <TableCell className="font-medium">{asset.asset_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{catName ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{asset.depreciation_method ?? "straight_line"}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {monthly != null ? formatCurrency(monthly) : "—"}
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(accumDep)}</TableCell>
                        <TableCell className="text-right">
                          {monthly != null ? formatCurrency(Math.max(0, nbvAfter)) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Results */}
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
                {result.journal_entry_ids.length} journal {result.journal_entry_ids.length === 1 ? "entry" : "entries"} created
              </p>
            )}

            {result.errors && result.errors.length > 0 && (
              <Collapsible open={errorsOpen} onOpenChange={setErrorsOpen} className="mt-4">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center gap-2 w-full text-left font-medium">
                        {result.errors.length} error{result.errors.length > 1 ? "s" : ""} during run
                        {errorsOpen ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <ul className="mt-2 space-y-1 text-xs">
                        {result.errors.map((e, i) => <li key={i}>• {e}</li>)}
                      </ul>
                    </CollapsibleContent>
                  </AlertDescription>
                </Alert>
              </Collapsible>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
