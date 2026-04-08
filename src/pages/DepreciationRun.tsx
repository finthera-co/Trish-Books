import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Play, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useRunDepreciation, useFixedAssets } from "@/hooks/useFixedAssets";
import { formatCurrency } from "@/lib/currency";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function DepreciationRun() {
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const runDep = useRunDepreciation();
  const { data: assets } = useFixedAssets();
  const [result, setResult] = useState<{ processed: number; skipped: number } | null>(null);
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get("account_id");

  const allActive = assets?.filter(a => a.status === "active") ?? [];
  const activeAssets = useMemo(() => {
    if (!accountId) return allActive;
    return allActive.filter((a: any) => a.depreciation_account_id === accountId);
  }, [allActive, accountId]);

  const handleRun = async () => {
    const res = await runDep.mutateAsync(period);
    setResult(res);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Run Depreciation</h1>
        <p className="text-sm text-muted-foreground">Process monthly depreciation for all active assets</p>
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
                    <TableCell className="text-right">{formatCurrency(asset.net_book_value ?? (asset.cost - (asset.accumulated_depreciation ?? 0)))}</TableCell>
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
