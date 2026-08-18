import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, Ban, HelpCircle, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatCurrency } from "@/lib/currency";
import { useAccounts } from "@/hooks/useData";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import {
  previewWorkbook,
  useImportBankStatement,
  MAX_FILE_BYTES,
  type WorkbookPreview,
  type ImportResult,
  type ImportProgress,
} from "@/hooks/useBankStatementImport";
import { Progress } from "@/components/ui/progress";
import ImportHistory from "@/components/bank-import/ImportHistory";
import VerifyBatchDialog from "@/components/bank-import/VerifyBatchDialog";
import { toast } from "sonner";
import AccountCombobox from "@/components/shared/AccountCombobox";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (p: { year: number; month: number }) => `${MONTHS[p.month - 1]} ${p.year}`;

export default function BankStatementImport() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: accounts } = useAccounts();
  const { data: settings } = useAccountSettings();
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [verify, setVerify] = useState<{ id: string; label: string } | null>(null);
  const importMut = useImportBankStatement(setProgress);

  const bankAccounts = useMemo(
    () => (accounts || []).filter((a: any) =>
      a.is_active && a.is_postable && (
        a.account_subtype?.toLowerCase().includes("bank") ||
        a.account_subtype?.toLowerCase().includes("checking") ||
        a.account_subtype?.toLowerCase().includes("savings") ||
        (a.account_type === "Asset" && a.account_name?.toLowerCase().includes("bank"))
      )
    ),
    [accounts]
  );

  const suspenseConfigured =
    !!(settings as any)?.bank_import_unrecognized_deposit_account_id &&
    !!(settings as any)?.bank_import_unrecognized_payment_account_id;

  async function onFile(f: File | undefined) {
    if (!f) return;
    setResult(null);
    if (f.size > MAX_FILE_BYTES) {
      toast.error(`Workbook is ${(f.size / 1048576).toFixed(1)} MB; the limit is ${MAX_FILE_BYTES / 1048576} MB.`);
      return;
    }
    try {
      const pv = await previewWorkbook(f);
      setPreview(pv);
    } catch (e) {
      toast.error(`Could not read file: ${String(e)}`);
    }
  }

  async function runImport() {
    if (!preview || !bankAccountId) return;
    // Pass the full preview periods (not just year/month): their row counts let
    // the hook pack months into invocations that stay inside the edge runtime's
    // CPU budget. Dropping them would force one call per month.
    const periods = preview.periods;
    if (periods.length === 0) {
      toast.error("No dated transactions to import");
      return;
    }
    setProgress({ done: 0, total: periods.length, current: monthLabel(periods[0]) });
    const res = await importMut.mutateAsync({ file: preview.file, bank_account_id: bankAccountId, periods });
    setProgress(null);
    setResult(res);
  }

  // ── Results summary (aggregated across sheets) ─────────────────────────
  if (result) {
    const t = result.totals;
    const reasons = t.suspense_reasons ?? {};
    const failed = result.sheets.filter((x) => !x.ok);
    const discont = result.sheets.flatMap((x) => x.balance_discontinuities ?? []);
    const dups = result.sheets.flatMap((x) => x.duplicates ?? []);
    // Months whose posted totals disagree with the figure the sheet printed at
    // its own bottom — the check that catches a footer row being read as a
    // transaction, or a workbook whose totals simply don't foot.
    const unreconciled = result.sheets.filter(
      (x) => x.ok && x.reconciliation && x.reconciliation.declaredDebit !== null && !x.reconciliation.matched
    );
    const heldTotalsRows = result.sheets.flatMap((x) => x.totals_rows ?? []);
    return (
      <div className="space-y-6 max-w-7xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            {result.failed_sheets === 0
              ? <CheckCircle2 className="w-6 h-6 text-primary" />
              : <AlertTriangle className="w-6 h-6 text-amber-500" />}
            Import {result.failed_sheets === 0 ? "Complete" : "Partially Complete"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {result.posted_sheets} of {result.sheets.length} month(s) posted
            {result.engine_version && ` · engine ${result.engine_version}`}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card><CardContent className="pt-4">
            <p className="text-sm text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-4 h-4 text-primary" /> Posted to ledgers</p>
            <p className="text-2xl font-bold text-foreground">{t.posted_to_ledger_count}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(t.posted_to_ledger_value)}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4">
            <p className="text-sm text-muted-foreground flex items-center gap-1"><Sparkles className="w-4 h-4 text-violet-500" /> Auto-generated ledgers</p>
            <p className="text-2xl font-bold text-violet-600">{t.posted_to_generated_count}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(t.posted_to_generated_value)} · named from description</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4">
            <p className="text-sm text-muted-foreground flex items-center gap-1"><HelpCircle className="w-4 h-4 text-amber-500" /> Posted to Suspense</p>
            <p className="text-2xl font-bold text-amber-600">{t.posted_to_suspense_count}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(t.posted_to_suspense_value)}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4">
            <p className="text-sm text-muted-foreground flex items-center gap-1"><Ban className="w-4 h-4 text-destructive" /> Held (corrupt)</p>
            <p className="text-2xl font-bold text-destructive">{t.blocked_count}</p>
            <p className="text-xs text-muted-foreground">{t.excluded_count} B/F rows excluded</p>
            {t.blocked_count > 0 && (
              // This summary is in-memory and dies on refresh; Held Rows reads
              // the same rows back from the database.
              <Button variant="link" size="sm" className="h-auto p-0 mt-1 text-xs"
                onClick={() => navigate("/banking/held-rows")}>
                See which rows and why →
              </Button>
            )}
          </CardContent></Card>
        </div>

        {unreconciled.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {unreconciled.length} month(s) do not match the totals printed in the file
            </AlertTitle>
            <AlertDescription className="text-xs space-y-2">
              <p>
                The rows that posted do not add up to the sheet's own bottom-line figure. Check those
                rows in Excel before relying on these ledgers — a footer or subtotal line counted as a
                transaction is the usual cause.
              </p>
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Posted Dr / Cr</TableHead>
                    <TableHead className="text-right">File says</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unreconciled.map((x) => {
                    const r = x.reconciliation!;
                    return (
                      <TableRow key={x.sheet_name}>
                        <TableCell className="font-medium">{x.sheet_name}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(r.computedDebit)} / {formatCurrency(r.computedCredit)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(r.declaredDebit ?? 0)} / {formatCurrency(r.declaredCredit ?? 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {!r.debitMatches && <div>Dr {formatCurrency((r.declaredDebit ?? 0) - r.computedDebit)}</div>}
                          {!r.creditMatches && <div>Cr {formatCurrency((r.declaredCredit ?? 0) - r.computedCredit)}</div>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {heldTotalsRows.length > 0 && (
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>
              {heldTotalsRows.length} total row(s) held, not posted
            </AlertTitle>
            <AlertDescription className="text-xs">
              These carried an amount but no date, description, name, voucher or account type — the
              shape of a spreadsheet footer, not a transaction. They were kept out of the ledger and
              used only to check the figures above:
              <ul className="mt-2 space-y-1 font-mono">
                {heldTotalsRows.slice(0, 8).map((t) => (
                  <li key={`${t.sheetName}-${t.rowIndex}`}>
                    {t.sheetName} row {t.rowIndex} — Dr {formatCurrency(t.debit)} / Cr {formatCurrency(t.credit)}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {failed.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{failed.length} month(s) did not post</AlertTitle>
            <AlertDescription className="text-xs">
              Each month posts independently, so the months above are safely posted. Fix the cause and re-import
              only these:
              <ul className="mt-2 space-y-1">
                {failed.map((x) => (
                  <li key={x.sheet_name}><strong>{x.sheet_name}</strong> — {x.error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Per-month result</CardTitle></CardHeader>
          {/* Seven columns: let the table scroll inside the card rather than
              squeezing every column on a narrow screen. */}
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">To ledgers</TableHead>
                  <TableHead className="text-right">Auto-gen</TableHead>
                  <TableHead className="text-right">To Suspense</TableHead>
                  <TableHead className="text-right">Held</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Verify</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.sheets.map((x) => {
                  const sm = (x.summary ?? {}) as any;
                  return (
                    <TableRow key={x.sheet_name}>
                      <TableCell className="font-medium">{x.sheet_name}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{x.ok ? sm.posted_to_ledger_count ?? 0 : "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-violet-600">{x.ok ? sm.posted_to_generated_count ?? 0 : "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{x.ok ? sm.posted_to_suspense_count ?? 0 : "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{x.ok ? sm.blocked_count ?? 0 : "—"}</TableCell>
                      <TableCell>
                        {x.ok
                          ? <Badge variant="default" className="gap-1"><CheckCircle2 className="w-3 h-3" /> Posted</Badge>
                          : <Badge variant="destructive" title={x.error}>Failed</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        {x.ok && x.batch_id && (
                          <Button size="sm" variant="outline" onClick={() => setVerify({ id: x.batch_id!, label: x.sheet_name })}>
                            <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Check DB
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {Object.keys(reasons).length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Why lines went to Suspense</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Object.entries(reasons).map(([reason, n]) => (
                  <Badge key={reason} variant="outline" className="gap-1">
                    {reason.replace(/_/g, " ")} <span className="font-bold">{n}</span>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {discont.length > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{discont.length} balance discontinuit(ies) flagged</AlertTitle>
            <AlertDescription className="text-xs">
              The running balance in the sheet did not match the computed balance at these rows. This does not block
              posting — review them against the source workbook.
            </AlertDescription>
          </Alert>
        )}

        {dups.length > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{dups.length} duplicate tuple(s) flagged</AlertTitle>
            <AlertDescription className="text-xs">
              Same date, description and amounts appear more than once. Salary runs legitimately repeat — these are
              flagged, not rejected.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-3">
          <Button onClick={() => navigate("/banking/suspense-clearing")}>Go to Suspense Clearing</Button>
          <Button variant="outline" onClick={() => { setResult(null); setPreview(null); setBankAccountId(""); }}>
            Import another file
          </Button>
        </div>

        <VerifyBatchDialog batchId={verify?.id ?? null} label={verify?.label}
          open={!!verify} onOpenChange={(o) => !o && setVerify(null)} />
      </div>
    );
  }

  // ── Upload + confirm ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <FileSpreadsheet className="w-6 h-6 text-primary" /> Bank Statement Import
        </h1>
        <p className="text-sm text-muted-foreground">
          Upload the monthly payment-analysis workbook. One action parses, categorizes, validates and posts every
          line — mapped lines to their ledger account; unmapped-but-clear lines to a ledger auto-generated from
          their description; anything ambiguous or corrupt to Suspense.
        </p>
      </div>

      {!suspenseConfigured && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Unrecognized accounts not configured</AlertTitle>
          <AlertDescription>
            The pipeline needs a safe home for unresolved lines and will not run without it. Open
            Settings → Account Mapping → <strong>Bank Import</strong> and press <strong>Run setup</strong> — that
            creates the standard chart and sets <strong>Unrecognized Deposits</strong> (money in) and{" "}
            <strong>Unrecognized Payments</strong> (money out).
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Select bank account</CardTitle>
          <CardDescription>The ledger account this statement belongs to.</CardDescription>
        </CardHeader>
        <CardContent>
          <AccountCombobox
            options={bankAccounts}
            value={bankAccountId}
            onChange={setBankAccountId}
            placeholder="Choose a bank account…"
            emptyText="No postable bank accounts found"
            className="max-w-md"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Upload workbook (.xlsx)</CardTitle>
          <CardDescription>
            Every sheet is read and the rows are grouped by their own transaction date. Each calendar month below
            posts as its own atomic batch — a whole-year file just becomes several monthly imports.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={!bankAccountId}>
            <Upload className="w-4 h-4 mr-2" /> {preview ? "Choose a different file" : "Choose file"}
          </Button>
          {!bankAccountId && <p className="text-xs text-muted-foreground">Select a bank account first.</p>}

          {preview && (
            <>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
                <p className="font-medium text-foreground">
                  {preview.total_rows.toLocaleString()} data row(s) read across {preview.sheet_count} sheet(s)
                  {" "}— every row is accounted for below:
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
                  <span><strong className="text-foreground">{preview.dated_count.toLocaleString()}</strong> dated → {preview.periods.length} month(s)</span>
                  {preview.excluded_count > 0 && <span><strong className="text-foreground">{preview.excluded_count}</strong> B/F excluded</span>}
                  {preview.forward_filled_count > 0 && <span><strong className="text-foreground">{preview.forward_filled_count.toLocaleString()}</strong> blank-date rows dated from the row above</span>}
                  {preview.undated_count > 0 && <span className="text-amber-600"><strong>{preview.undated_count}</strong> undated → held for review</span>}
                </div>
                {preview.forward_filled_count > 0 && (
                  <p className="text-muted-foreground">
                    Rows given the date above them (verify these have a blank date cell in Excel):{" "}
                    {preview.forward_filled_samples.join(", ")}
                    {preview.forward_filled_count > preview.forward_filled_samples.length && ", …"}
                  </p>
                )}
                {preview.unparseable_date_samples.length > 0 && (
                  <p className="text-amber-700">
                    Unreadable date formats (held): {preview.unparseable_date_samples.map((s) => `"${s}"`).join(", ")}
                  </p>
                )}
              </div>
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.periods.map((p) => (
                    <TableRow key={`${p.year}-${p.month}`}>
                      <TableCell className="font-medium">{monthLabel(p)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {p.row_count.toLocaleString()}
                        {p.excluded_count > 0 && <span className="text-muted-foreground"> (+{p.excluded_count} B/F)</span>}
                      </TableCell>
                      <TableCell>
                        {p.too_big
                          ? <Badge variant="destructive" title="Exceeds the per-month row limit">Too large</Badge>
                          : <Badge variant="default" className="gap-1"><CheckCircle2 className="w-3 h-3" /> Ready</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          size="lg"
          onClick={runImport}
          disabled={!preview || !bankAccountId || !suspenseConfigured || importMut.isPending || preview.periods.length === 0}
        >
          {importMut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing…</> : <>Import & post</>}
        </Button>
      </div>

      {progress && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{progress.current || "Finishing up…"}</span>
            </div>
            <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} className={progress.done >= progress.total ? "" : "animate-pulse"} />
            <p className="text-xs text-muted-foreground">
              The file is parsed once on the server, then each month ({progress.total}) posts as its own
              atomic transaction. Large statements can take a little while.
            </p>
          </CardContent>
        </Card>
      )}

      <ImportHistory />
    </div>
  );
}
