import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Edit, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useFixedAsset, useAssetDepreciation, useDisposeAsset, useAssetJournalEntries } from "@/hooks/useFixedAssets";
import { useAccounts } from "@/hooks/useData";
import { formatCurrency } from "@/lib/currency";
import { generateDepreciationSchedule, type Asset } from "@/lib/depreciation";
import { Progress } from "@/components/ui/progress";
import AccountCombobox from "@/components/shared/AccountCombobox";

export default function AssetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: asset, isLoading } = useFixedAsset(id);
  const { data: depRecords } = useAssetDepreciation(id);
  const { data: journalEntries } = useAssetJournalEntries(id);
  const { data: accounts } = useAccounts();
  const disposeAsset = useDisposeAsset();
  const [disposeOpen, setDisposeOpen] = useState(false);
  const [saleValue, setSaleValue] = useState(0);
  const [cashAccountId, setCashAccountId] = useState("");

  const cashAccounts = useMemo(() => {
    return (accounts ?? []).filter((a: any) =>
      a.is_active && a.account_type === "Asset" && (
        a.account_name?.toLowerCase().includes("cash") ||
        a.account_name?.toLowerCase().includes("bank")
      )
    );
  }, [accounts]);

  if (isLoading || !asset) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading asset...</div>;
  }

  // NBV is always computed dynamically: cost - accumulated_depreciation
  const nbv = asset.cost - (asset.accumulated_depreciation ?? 0);
  const depPercent = asset.cost > 0 ? ((asset.accumulated_depreciation ?? 0) / asset.cost) * 100 : 0;

  const getAccountLabel = (accountId: string | null) => {
    if (!accountId || !accounts) return "—";
    const acct = accounts.find(a => a.id === accountId);
    return acct ? `${acct.account_code} – ${acct.account_name}` : "—";
  };

  // Generate projected schedule
  const assetForCalc: Asset = {
    id: asset.id,
    cost: asset.cost,
    salvage_value: asset.salvage_value ?? 0,
    useful_life_months: asset.useful_life_months ?? 12,
    start_date: asset.start_date || asset.acquisition_date || new Date().toISOString().split("T")[0],
    status: asset.status as "active" | "disposed",
  };
  const projectedSchedule = generateDepreciationSchedule(assetForCalc);

  const handleDispose = async () => {
    await disposeAsset.mutateAsync({ assetId: asset.id, saleValue, cashAccountId });
    setDisposeOpen(false);
    navigate("/assets");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/assets")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{asset.asset_name}</h1>
            <p className="text-sm text-muted-foreground">{asset.description || "No description"}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(`/assets/${asset.id}/edit`)}>
            <Edit className="w-4 h-4 mr-2" /> Edit
          </Button>
          {asset.status === "active" && (
            <Button variant="destructive" onClick={() => setDisposeOpen(true)}>
              <AlertTriangle className="w-4 h-4 mr-2" /> Dispose
            </Button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Cost</CardTitle></CardHeader>
          <CardContent><p className="text-xl font-bold">{formatCurrency(asset.cost)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Accum. Depreciation</CardTitle></CardHeader>
          <CardContent><p className="text-xl font-bold">{formatCurrency(asset.accumulated_depreciation)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Net Book Value</CardTitle></CardHeader>
          <CardContent><p className="text-xl font-bold">{formatCurrency(nbv)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Status</CardTitle></CardHeader>
          <CardContent>
            <Badge variant={asset.status === "active" ? "default" : "secondary"} className="text-sm">{asset.status}</Badge>
          </CardContent>
        </Card>
      </div>

      {/* Linked Accounts */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Linked Accounts</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground mb-1">Asset Account</p>
              <p className="font-medium">{getAccountLabel(asset.asset_account_id)}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Accumulated Depreciation</p>
              <p className="font-medium">{getAccountLabel(asset.depreciation_account_id)}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Depreciation Expense</p>
              <p className="font-medium">{getAccountLabel((asset as any).depr_expense_account_id)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Depreciation Progress */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Depreciation Progress</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Depreciated</span>
              <span className="font-medium">{depPercent.toFixed(1)}%</span>
            </div>
            <Progress value={depPercent} className="h-3" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Salvage: {formatCurrency(asset.salvage_value ?? 0)}</span>
              <span>Life: {asset.useful_life_months ?? 12} months</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actual Depreciation Records */}
      {depRecords && depRecords.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Depreciation History</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Depreciation</TableHead>
                  <TableHead className="text-right">Accumulated</TableHead>
                  <TableHead className="text-right">Net Book Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {depRecords.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.period}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.depreciation_amount)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.accumulated_depreciation)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.net_book_value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Linked Journal Entries */}
      {journalEntries && journalEntries.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Linked Journal Entries</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {journalEntries.map((je: any) =>
                  (je.journal_lines ?? []).map((line: any, idx: number) => (
                    <TableRow key={`${je.id}-${idx}`}>
                      {idx === 0 ? (
                        <>
                          <TableCell rowSpan={je.journal_lines.length} className="font-medium align-top">{je.entry_date}</TableCell>
                          <TableCell rowSpan={je.journal_lines.length} className="align-top">{je.description}</TableCell>
                        </>
                      ) : null}
                      <TableCell className="text-sm">
                        {line.accounts ? `${line.accounts.account_code} – ${line.accounts.account_name}` : "—"}
                      </TableCell>
                      <TableCell className="text-right">{line.debit > 0 ? formatCurrency(line.debit) : ""}</TableCell>
                      <TableCell className="text-right">{line.credit > 0 ? formatCurrency(line.credit) : ""}</TableCell>
                      {idx === 0 ? (
                        <TableCell rowSpan={je.journal_lines.length} className="align-top">
                          <Badge variant={je.status === "posted" ? "default" : "secondary"}>{je.status}</Badge>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Projected Schedule */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Projected Depreciation Schedule</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Monthly Depreciation</TableHead>
                <TableHead className="text-right">Accumulated</TableHead>
                <TableHead className="text-right">Net Book Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projectedSchedule.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.period}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.depreciation_amount)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.accumulated_depreciation)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.net_book_value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dispose Dialog */}
      <Dialog open={disposeOpen} onOpenChange={setDisposeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispose Asset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Current Net Book Value: <strong>{formatCurrency(nbv)}</strong>
            </p>
            <div>
              <label className="text-sm font-medium">Sale Value</label>
              <Input
                type="number"
                step="0.01"
                value={saleValue}
                onChange={e => setSaleValue(Number(e.target.value))}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Cash/Bank Account</label>
              <AccountCombobox
                options={cashAccounts}
                value={cashAccountId}
                onChange={setCashAccountId}
                placeholder="Select account"
              />
            </div>
            <p className="text-sm">
              Gain/Loss: <strong className={saleValue - nbv >= 0 ? "text-green-600" : "text-red-600"}>
                {formatCurrency(saleValue - nbv)}
              </strong>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisposeOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDispose} disabled={disposeAsset.isPending}>
              Confirm Disposal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
