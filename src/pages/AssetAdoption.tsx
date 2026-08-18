import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Wand2, AlertCircle, CheckCircle, Info, ChevronDown, ChevronRight, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { formatCurrency } from "@/lib/currency";
import {
  useCoaAssetAnalysis, useAdoptCoaAssets, summariseByClass,
  type AdoptionResult, type CoaAssetCandidate,
} from "@/hooks/useAssetAdoption";

function monthsLabel(m: number) {
  if (!m) return "—";
  const years = m / 12;
  return Number.isInteger(years) ? `${years} yr${years === 1 ? "" : "s"}` : `${m} mo`;
}

export default function AssetAdoption() {
  const navigate = useNavigate();
  const [through, setThrough] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [result, setResult] = useState<AdoptionResult | null>(null);

  const { data: rows, isLoading } = useCoaAssetAnalysis(through || null);
  const adopt = useAdoptCoaAssets();

  const pending = useMemo(() => (rows ?? []).filter(r => !r.already_adopted), [rows]);
  const classes = useMemo(() => summariseByClass(rows ?? []), [rows]);
  const pendingClasses = useMemo(() => summariseByClass(pending), [pending]);

  const totals = useMemo(() => ({
    assets: pending.length,
    cost: pending.reduce((s, r) => s + r.cost, 0),
    depreciation: pending.reduce((s, r) => s + r.est_depreciation, 0),
    nbv: pending.reduce((s, r) => s + r.est_net_book_value, 0),
  }), [pending]);

  const detailByAccount = useMemo(() => {
    const map = new Map<string, CoaAssetCandidate[]>();
    (rows ?? []).forEach(r => {
      const list = map.get(r.account_id) ?? [];
      list.push(r);
      map.set(r.account_id, list);
    });
    return map;
  }, [rows]);

  const alreadyDone = (rows?.length ?? 0) > 0 && pending.length === 0;

  const handleRun = async () => {
    const res = await adopt.mutateAsync({
      throughPeriod: through || null,
      postDepreciation: true,
    });
    setResult(res);
  };

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild><Link to="/assets/register">Fixed Assets</Link></BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Build from Chart of Accounts</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Build Register from Chart of Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Every capitalised purchase already sitting on a PP&amp;E ledger becomes an asset record,
          with its IAS 16 depreciation schedule generated and every missed month posted.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm">
          The cost is already in the general ledger, so no acquisition journal is re-posted — each
          asset is attached to the debit that is already there. The only new postings are the
          depreciation charges: <span className="font-medium">Dr Depreciation expense / Cr Accumulated
          depreciation</span>, one journal per month. Land is registered but never depreciated (IAS 16.58).
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Depreciate through</CardTitle>
          <CardDescription>
            Charges are caught up from each asset's acquisition month to this month. Leave blank to
            use the last month with posted transactions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-sm font-medium">Period (YYYY-MM)</label>
              <Input
                type="month"
                value={through}
                onChange={e => { setThrough(e.target.value); setResult(null); }}
                className="w-48"
              />
            </div>
            <Button onClick={handleRun} disabled={adopt.isPending || isLoading || alreadyDone}>
              <Wand2 className="w-4 h-4 mr-2" />
              {adopt.isPending ? "Building register..." : "Build register & post depreciation"}
            </Button>
            {alreadyDone && (
              <span className="text-sm text-muted-foreground">
                Every PP&amp;E posting is already in the register.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Assets to create</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{totals.assets}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total cost</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatCurrency(totals.cost)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Depreciation to post</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatCurrency(totals.depreciation)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Net book value</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatCurrency(totals.nbv)}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Asset classes detected</CardTitle>
          <CardDescription>
            The useful life is taken from the ledger name. Adjust any of them afterwards under
            Assets → Asset Categories; the schedule follows the category.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Ledger</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Useful life</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Assets</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Depreciation</TableHead>
                <TableHead className="text-right">NBV</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Analysing chart of accounts…</TableCell></TableRow>
              ) : classes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="w-5 h-5 mx-auto mb-2" />
                    No capitalised postings found on any PP&amp;E ledger.
                  </TableCell>
                </TableRow>
              ) : (
                classes.map(c => {
                  const isOpen = expanded === c.account_id;
                  const detail = detailByAccount.get(c.account_id) ?? [];
                  const remaining = pendingClasses.find(p => p.account_id === c.account_id);
                  return (
                    <Fragment key={c.account_id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : c.account_id)}
                      >
                        <TableCell>
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </TableCell>
                        <TableCell className="font-medium">
                          {c.account_code} · {c.account_name}
                          {c.adopted_count > 0 && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({c.adopted_count} already in register)
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {c.is_depreciable ? (
                            <Badge variant="outline">{c.class_key.replace(/_/g, " ")}</Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1">
                              <Landmark className="w-3 h-3" /> not depreciated
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>{c.is_depreciable ? monthsLabel(c.useful_life_months) : "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {c.is_depreciable ? c.depreciation_method.replace(/_/g, " ") : "—"}
                        </TableCell>
                        <TableCell className="text-right">{remaining?.asset_count ?? 0}</TableCell>
                        <TableCell className="text-right">{formatCurrency(c.total_cost)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(c.est_depreciation)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(c.est_net_book_value)}</TableCell>
                      </TableRow>
                      {isOpen && detail.map(d => (
                        <TableRow key={d.journal_line_id} className="bg-muted/40">
                          <TableCell />
                          <TableCell className="pl-6 text-sm">{d.proposed_name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{d.entry_date}</TableCell>
                          <TableCell className="text-sm text-muted-foreground" colSpan={2}>
                            {d.already_adopted
                              ? "already in register"
                              : d.is_depreciable
                                ? `${d.months_to_charge} of ${d.useful_life_months} months charged`
                                : "no depreciation"}
                          </TableCell>
                          <TableCell />
                          <TableCell className="text-right text-sm">{formatCurrency(d.cost)}</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(d.est_depreciation)}</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(d.est_net_book_value)}</TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {result && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-primary" />
              <h3 className="text-lg font-semibold">Register built</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                ["Assets created", result.assets_created],
                ["Categories created", result.categories_created],
                ["GL accounts created", result.accounts_created],
                ["Months posted", result.periods_posted],
                ["Depreciation posted", formatCurrency(Number(result.depreciation_posted ?? 0))],
              ].map(([label, value]) => (
                <div key={label as string} className="text-center p-4 rounded-lg bg-background">
                  <p className="text-xl font-bold text-primary">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            {result.periods?.some(p => p.skipped_reason) && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Skipped {result.periods.filter(p => p.skipped_reason).map(p => p.period).join(", ")} —
                  those months fall in a closed fiscal period. Reopen them and run again to post the charge.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button size="sm" onClick={() => navigate("/assets/register")}>Open asset register</Button>
              <Button size="sm" variant="outline" onClick={() => navigate("/reports/financial?report=fixed-asset-schedule")}>
                Asset schedule
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
