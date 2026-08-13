import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Loader2, RotateCw, Upload, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import AccountSelector from "@/components/shared/AccountSelector";
import { useNavigate } from "react-router-dom";
import { usePettyCashAccounts } from "@/hooks/usePettyCash";
import {
  useCreatePCImportBatch,
  useDiscardPCImportBatch,
  useExcludePCImportLines,
  usePCImportBatch,
  usePCImportLines,
  usePCImportReadiness,
  usePostPCImportBatch,
  useResolvePCImportBatch,
  useRestorePCImportLines,
  useUpdatePCImportLine,
  useUpsertPCAccountMap,
  type PCImportLineFilter,
  type PostSummary,
  type ResolveSummary,
} from "@/hooks/usePettyCashImport";
import {
  normalizeKey,
  parsePettyCashWorkbook,
  type ImportDateFormat,
  type ParseResult,
} from "@/lib/pettyCashImportParser";
import { formatCurrency } from "@/lib/currency";

type Step = 1 | 2 | 3 | 4;

const CHOOSABLE_FORMATS: Exclude<ImportDateFormat, "EXCEL_SERIAL">[] = [
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "YYYY-MM-DD",
];

/** Accounts a petty cash line may resolve to, per the Phase C rules. */
const OUT_TYPES = ["Asset", "Expense", "Other Expense", "Cost of Goods Sold"];
const IN_TYPES = ["Asset", "Liability", "Income", "Other Income", "Equity"];

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

type PCImportDialogProps = {
  trigger?: React.ReactNode;
  /** Reopens an already-staged batch straight at the resolve step. */
  resumeBatchId?: string | null;
  /** Controlled mode, used by the imports page's Resume action. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function PCImportDialog({
  trigger,
  resumeBatchId,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: PCImportDialogProps) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (o: boolean) => {
    if (!controlled) setOpenState(o);
    onOpenChangeProp?.(o);
  };
  const [step, setStep] = useState<Step>(1);

  const [fundId, setFundId] = useState("");
  const [orientation, setOrientation] = useState<"contra" | "fund">("contra");
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [chosenFormat, setChosenFormat] = useState<Exclude<ImportDateFormat, "EXCEL_SERIAL">>("DD/MM/YYYY");

  const [batchId, setBatchId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ResolveSummary | null>(null);
  const [postResult, setPostResult] = useState<PostSummary | null>(null);
  const [filter, setFilter] = useState<PCImportLineFilter>("all");
  const [remember, setRemember] = useState<Record<string, boolean>>({});

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const navigate = useNavigate();
  const { data: funds } = usePettyCashAccounts();
  const { data: readiness, isLoading: readinessLoading } = usePCImportReadiness();
  const { data: batch } = usePCImportBatch(batchId ?? undefined);
  const { data: lines } = usePCImportLines(batchId ?? undefined, filter);

  const createBatch = useCreatePCImportBatch();
  const resolveBatch = useResolvePCImportBatch();
  const postBatch = usePostPCImportBatch();
  const discardBatch = useDiscardPCImportBatch();
  const updateLine = useUpdatePCImportLine();
  const excludeLines = useExcludePCImportLines();
  const restoreLines = useRestorePCImportLines();
  const upsertMap = useUpsertPCAccountMap();

  // Resuming a kept batch drops the user straight into step 3, with the edits
  // they already made still on the staged rows.
  useEffect(() => {
    if (open && resumeBatchId && resumeBatchId !== batchId) {
      setBatchId(resumeBatchId);
      setStep(3);
      setFilter("all");
    }
  }, [open, resumeBatchId, batchId]);

  const verdict = parseResult?.dateVerdict;
  const conflicting = verdict?.kind === "conflicting";
  const ambiguous = verdict?.kind === "ambiguous";
  const counts = batch?.counts;
  const blockedCount = counts?.blocked ?? 0;

  function resetAll() {
    setStep(1);
    setFile(null);
    setParseResult(null);
    setParseError(null);
    setBatchId(null);
    setSummary(null);
    setPostResult(null);
    setFilter("all");
    setRemember({});
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /**
   * Clearing the input's value matters: without it, picking the *same* file
   * again fires no change event and the dialog looks frozen.
   */
  function removeFile() {
    setFile(null);
    setParseResult(null);
    setParseError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(f: File, sheetName?: string) {
    setParsing(true);
    setParseError(null);
    try {
      const res = await parsePettyCashWorkbook(f, {
        sheetName,
        dateFormat: chosenFormat,
      });
      setFile(f);
      setParseResult(res);
      if (res.dateVerdict.kind === "resolved" && res.dateVerdict.format !== "EXCEL_SERIAL") {
        setChosenFormat(res.dateVerdict.format);
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Could not read this workbook");
      setParseResult(null);
    } finally {
      setParsing(false);
    }
  }

  async function stageBatch() {
    if (!parseResult || !file || !fundId) return;
    const effectiveFormat: ImportDateFormat =
      parseResult.dateVerdict.kind === "resolved" ? parseResult.dateVerdict.format : chosenFormat;

    // Re-parse when the user picked a format for an ambiguous file, so the
    // staged parsed_date reflects their choice rather than the default.
    const source =
      parseResult.dateVerdict.kind === "ambiguous"
        ? await parsePettyCashWorkbook(file, {
            sheetName: parseResult.sheetName,
            dateFormat: chosenFormat,
          })
        : parseResult;

    createBatch.mutate(
      {
        pettyCashAccountId: fundId,
        fileName: file.name,
        fileHash: source.fileHash,
        sheetName: source.sheetName,
        dateFormat: effectiveFormat,
        amountOrientation: orientation,
        rows: source.rows,
      },
      {
        onSuccess: ({ batchId: id, summary: s }) => {
          setBatchId(id);
          setSummary(s);
          setStep(3);
        },
      },
    );
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      setOpen(true);
      return;
    }
    // A staged, unposted batch must not be silently orphaned.
    if (batchId && (batch?.status === "draft" || batch?.status === "resolved")) {
      setConfirmClose(true);
      return;
    }
    setOpen(false);
    resetAll();
  }

  const previewRows = parseResult?.rows.slice(0, 10) ?? [];

  return (
    <>
      {!controlled && (
        <span onClick={() => setOpen(true)}>
          {trigger ?? (
            <Button variant="outline">
              <Upload className="w-4 h-4 mr-1" /> Import Excel
            </Button>
          )}
        </span>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4" />
              Import petty cash book
              <Badge variant="outline" className="ml-2 text-xs">
                Step {step} of 4
              </Badge>
            </DialogTitle>
            <DialogDescription className="text-xs">
              {step === 1 && "Choose the fund and the workbook. Nothing is written until you post."}
              {step === 2 && "Check how the columns and dates were read before staging."}
              {step === 3 && "Resolve every row. The batch is staged but not in the ledger yet."}
              {step === 4 && "Review the totals, then post to the ledger."}
            </DialogDescription>
          </DialogHeader>

          {/* ── Step 1: upload ─────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              {/* A tenant with no fund cannot import at all. Say so, and point
                  at the one screen that fixes it, rather than presenting an
                  empty dropdown with "Select a fund first" underneath. */}
              {!readinessLoading && !readiness?.hasActiveFund ? (
                <div className="rounded-md border border-warning/40 bg-warning/5 p-3 space-y-2">
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    <Wallet className="w-4 h-4" />
                    {readiness?.hasAnyFund
                      ? "Every petty cash fund is inactive"
                      : "No petty cash fund set up yet"}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {readiness?.hasAnyFund
                      ? "An import posts into a fund, and an inactive fund cannot receive postings. Reactivate one first."
                      : "An import posts vouchers into a petty cash fund — the cash box itself, linked to its GL account. Create one before importing."}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      setOpen(false);
                      resetAll();
                      navigate("/banking/petty-cash");
                    }}
                  >
                    Go to Petty Cash
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-sm">Petty cash fund</Label>
                  <Select value={fundId} onValueChange={setFundId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select the fund to import into" />
                    </SelectTrigger>
                    <SelectContent>
                      {(funds ?? [])
                        .filter((f) => f.is_active)
                        .map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.account_name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Not a blocker on its own, but an unmapped account type turns
                  it into one mid-wizard, so flag it before the upload. */}
              {!readinessLoading && readiness?.hasActiveFund && !readiness?.hasSuspenseAccount && (
                <div className="rounded-md border border-muted p-2.5 text-xs space-y-1">
                  <span className="font-medium">No suspense account configured.</span>{" "}
                  <span className="text-muted-foreground">
                    Rows whose account type cannot be matched have nowhere to go, and will block the
                    batch until one is set.
                  </span>
                  <Button
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={() => {
                      setOpen(false);
                      resetAll();
                      navigate("/settings/account-mapping");
                    }}
                  >
                    Set it under Settings → Account Mapping
                  </Button>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-sm">What do the Debit and Credit columns mean?</Label>
                <RadioGroup
                  value={orientation}
                  onValueChange={(v) => setOrientation(v as "contra" | "fund")}
                  className="gap-2"
                >
                  <label className="flex items-start gap-2 rounded-md border p-2.5 cursor-pointer hover:bg-muted/40">
                    <RadioGroupItem value="contra" className="mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">Against the expense account (usual)</div>
                      <div className="text-xs text-muted-foreground">
                        Debit means money went <strong>out</strong> of the box. Credit means money came in.
                      </div>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 rounded-md border p-2.5 cursor-pointer hover:bg-muted/40">
                    <RadioGroupItem value="fund" className="mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">From the fund's own point of view</div>
                      <div className="text-xs text-muted-foreground">
                        Debit means money came <strong>in</strong> to the box. Credit means it went out.
                      </div>
                    </div>
                  </label>
                </RadioGroup>
              </div>

              {!parseResult && (
                <div className="space-y-1.5">
                  <Label className="text-sm">Workbook</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    disabled={!fundId || parsing}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFile(f);
                    }}
                    className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:text-primary-foreground"
                  />
                  {!fundId && (
                    <p className="text-xs text-muted-foreground">Select a fund first.</p>
                  )}
                  {parsing && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Reading workbook…
                    </p>
                  )}
                </div>
              )}

              {parseError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                  {parseError}
                </div>
              )}

              {parseResult && file && (
                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">{file.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {bytes(file.size)} · sheet “{parseResult.sheetName}” · {parseResult.rows.length} row(s)
                      </div>
                    </div>
                    {/* Nothing is in the database yet, so no confirmation. */}
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={removeFile}>
                      <X className="w-3 h-3 mr-1" /> Remove file
                    </Button>
                  </div>

                  {parseResult.sheetNames.length > 1 && (
                    <div className="space-y-1">
                      <Label className="text-xs">Sheet</Label>
                      <Select
                        value={parseResult.sheetName}
                        onValueChange={(s) => file && void handleFile(file, s)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {parseResult.sheetNames.map((s) => (
                            <SelectItem key={s} value={s} className="text-xs">
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {parseResult.missingColumns.length > 0 && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                      Missing required column(s): {parseResult.missingColumns.join(", ")}. Check the header row.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: review ─────────────────────────────────────────── */}
          {step === 2 && parseResult && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(parseResult.headerMap).map((k) => (
                  <Badge key={k} variant="secondary" className="text-xs">
                    {k.replace(/_/g, " ")} → col {parseResult.headerMap[k] + 1}
                  </Badge>
                ))}
              </div>

              {conflicting && verdict.kind === "conflicting" && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1">
                  <div className="text-sm font-medium text-destructive flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" /> This file mixes two date formats
                  </div>
                  <p className="text-xs text-destructive/90">
                    “{verdict.evidenceDayFirst}” can only be day-first and “{verdict.evidenceMonthFirst}” can only
                    be month-first. No single interpretation is correct, so the upload is refused — fix the dates in
                    the sheet and try again.
                  </p>
                </div>
              )}

              {ambiguous && verdict.kind === "ambiguous" && (
                <div className="rounded-md border border-warning/40 bg-warning/5 p-3 space-y-2">
                  <div className="text-sm font-medium">Which date format is this file?</div>
                  <p className="text-xs text-muted-foreground">
                    Every date in the file could be read either way, so it cannot be determined automatically.
                  </p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    {verdict.sample.map((s) => (
                      <span key={s} className="font-mono">
                        {s} → <strong>{parseDatePreview(s, "DD/MM/YYYY")}</strong> (day first) ·{" "}
                        <strong>{parseDatePreview(s, "MM/DD/YYYY")}</strong> (month first)
                      </span>
                    ))}
                  </div>
                  <RadioGroup
                    value={chosenFormat}
                    onValueChange={(v) => setChosenFormat(v as Exclude<ImportDateFormat, "EXCEL_SERIAL">)}
                    className="flex gap-4"
                  >
                    {CHOOSABLE_FORMATS.map((f) => (
                      <label key={f} className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <RadioGroupItem value={f} /> {f}
                      </label>
                    ))}
                  </RadioGroup>
                </div>
              )}

              {verdict?.kind === "resolved" && (
                <div className="text-xs text-muted-foreground">
                  Date format detected from the file: <strong>{verdict.format}</strong> — locked.
                </div>
              )}

              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead className="h-8">Row</TableHead>
                      <TableHead className="h-8">Raw date</TableHead>
                      <TableHead className="h-8">Reads as</TableHead>
                      <TableHead className="h-8">Voucher No.</TableHead>
                      <TableHead className="h-8">Account Type</TableHead>
                      <TableHead className="h-8 text-right">Debit</TableHead>
                      <TableHead className="h-8 text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((r) => (
                      <TableRow key={r.rowNo} className="text-xs">
                        <TableCell className="py-1.5">{r.rowNo}</TableCell>
                        <TableCell className="py-1.5 font-mono">{r.rawDate}</TableCell>
                        <TableCell className="py-1.5">
                          {r.parsedDate ?? <span className="text-destructive">unreadable</span>}
                        </TableCell>
                        <TableCell className="py-1.5">{r.rawVoucherNo}</TableCell>
                        <TableCell className="py-1.5">{r.rawAccountType}</TableCell>
                        <TableCell className="py-1.5 text-right font-mono">
                          {r.rawDebit} {r.debit === null ? "⚠" : ""}
                        </TableCell>
                        <TableCell className="py-1.5 text-right font-mono">
                          {r.rawCredit} {r.credit === null ? "⚠" : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Showing the first {previewRows.length} of {parseResult.rows.length} rows.
              </p>
            </div>
          )}

          {/* ── Step 3: resolve ────────────────────────────────────────── */}
          {step === 3 && batchId && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["all", "All", batch?.total ?? 0],
                    ["ok", "OK", counts?.ok ?? 0],
                    ["suspense", "Suspense", counts?.suspense ?? 0],
                    ["blocked", "Blocked", counts?.blocked ?? 0],
                    ["duplicate", "Duplicates", counts?.duplicates ?? 0],
                    ["excluded", "Excluded", counts?.excluded ?? 0],
                  ] as [PCImportLineFilter, string, number][]
                ).map(([key, label, n]) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`rounded-md border px-3 py-1.5 text-left transition-colors ${
                      filter === key ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-sm font-semibold">{n}</div>
                  </button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 self-end text-xs"
                  disabled={resolveBatch.isPending}
                  onClick={() =>
                    resolveBatch.mutate(batchId, { onSuccess: (s) => setSummary(s) })
                  }
                >
                  <RotateCw className="w-3 h-3 mr-1" /> Re-resolve
                </Button>
              </div>

              {blockedCount > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                  {blockedCount} row(s) are blocked. Fix the account, exclude the row, or discard the batch —
                  posting is disabled until none are left.
                </div>
              )}

              {summary && summary.unmapped_account_types.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Unmapped account types: {summary.unmapped_account_types.join(", ")}
                </div>
              )}

              <div className="border rounded-md overflow-x-auto max-h-[45vh] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow className="text-xs">
                      <TableHead className="h-8">Row</TableHead>
                      <TableHead className="h-8">Date</TableHead>
                      <TableHead className="h-8">Description</TableHead>
                      <TableHead className="h-8 text-right">Amount</TableHead>
                      <TableHead className="h-8">Status</TableHead>
                      <TableHead className="h-8 min-w-[220px]">Account</TableHead>
                      <TableHead className="h-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(lines ?? []).map((l) => {
                      const acct = (l as { accounts?: { account_code: string; account_name: string } }).accounts;
                      const needsPicker = l.status === "blocked" || l.status === "suspense";
                      const key = normalizeKey(l.raw_account_type ?? "");
                      return (
                        <TableRow key={l.id} className="text-xs align-top">
                          <TableCell className="py-1.5">{l.row_no}</TableCell>
                          <TableCell className="py-1.5 whitespace-nowrap">{l.parsed_date ?? "—"}</TableCell>
                          <TableCell className="py-1.5">
                            <div>{l.raw_description}</div>
                            <div className="text-muted-foreground">
                              {l.raw_voucher_no} · {l.raw_account_type}
                            </div>
                            {l.error_message && (
                              <div className="text-destructive mt-0.5">
                                <span className="font-mono">{l.error_code}</span> — {l.error_message}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="py-1.5 text-right font-mono whitespace-nowrap">
                            {l.amount === null
                              ? "—"
                              : `${l.direction === "in" ? "+" : "−"}${formatCurrency(Number(l.amount))}`}
                          </TableCell>
                          <TableCell className="py-1.5">
                            <Badge
                              variant="outline"
                              className={
                                l.status === "blocked"
                                  ? "border-destructive/40 text-destructive"
                                  : l.status === "suspense"
                                    ? "border-warning/40 text-warning"
                                    : l.status === "excluded"
                                      ? "text-muted-foreground"
                                      : "border-success/40 text-success"
                              }
                            >
                              {l.status}
                            </Badge>
                            {l.is_duplicate && (
                              <Badge variant="outline" className="ml-1 text-warning border-warning/40">
                                dup
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="py-1.5">
                            {needsPicker ? (
                              <div className="space-y-1">
                                <AccountSelector
                                  value={l.resolved_account_id}
                                  types={l.direction === "in" ? IN_TYPES : OUT_TYPES}
                                  placeholder="Pick an account…"
                                  onChange={(accountId) => {
                                    if (!accountId) return;
                                    updateLine.mutate({ lineId: l.id, accountId });
                                    if (remember[l.id] && key) {
                                      upsertMap.mutate({
                                        matchType: "account_type",
                                        matchKey: key,
                                        accountId,
                                      });
                                    }
                                  }}
                                />
                                {key && (
                                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                                    <Checkbox
                                      checked={!!remember[l.id]}
                                      onCheckedChange={(c) =>
                                        setRemember((r) => ({ ...r, [l.id]: c === true }))
                                      }
                                    />
                                    Remember “{key}” for next time
                                  </label>
                                )}
                              </div>
                            ) : acct ? (
                              <span>
                                {acct.account_code} {acct.account_name}
                                <span className="text-muted-foreground ml-1">({l.resolution_tier})</span>
                              </span>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="py-1.5">
                            {l.status === "excluded" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs"
                                onClick={() =>
                                  restoreLines.mutate([l.id], {
                                    onSuccess: () =>
                                      resolveBatch.mutate(batchId, { onSuccess: (s) => setSummary(s) }),
                                  })
                                }
                              >
                                Restore
                              </Button>
                            ) : (
                              l.status !== "posted" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-xs"
                                  onClick={() => excludeLines.mutate([l.id])}
                                >
                                  Exclude
                                </Button>
                              )
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* ── Step 4: post ───────────────────────────────────────────── */}
          {step === 4 && batchId && (
            <div className="space-y-3">
              {!postResult ? (
                <div className="rounded-md border p-3 space-y-1.5 text-sm">
                  <div className="font-medium">Ready to post</div>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Rows to post</dt>
                    <dd className="text-right">{(counts?.ok ?? 0) + (counts?.suspense ?? 0)}</dd>
                    <dt className="text-muted-foreground">To suspense</dt>
                    <dd className="text-right">{counts?.suspense ?? 0}</dd>
                    <dt className="text-muted-foreground">Excluded</dt>
                    <dd className="text-right">{counts?.excluded ?? 0}</dd>
                  </dl>
                  <p className="text-xs text-muted-foreground pt-1">
                    Vouchers, totals and the closing balance are computed in the ledger as it posts — the figures
                    below are returned by the database, not estimated here.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border border-success/40 bg-success/5 p-3 space-y-1.5">
                  <div className="text-sm font-medium">Posted</div>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Vouchers created</dt>
                    <dd className="text-right">{postResult.vouchers_created}</dd>
                    <dt className="text-muted-foreground">Receipts created</dt>
                    <dd className="text-right">{postResult.receipts_created}</dd>
                    <dt className="text-muted-foreground">Lines posted</dt>
                    <dd className="text-right">{postResult.lines_posted}</dd>
                    <dt className="text-muted-foreground">Lines excluded</dt>
                    <dd className="text-right">{postResult.lines_excluded}</dd>
                    <dt className="text-muted-foreground">Total out</dt>
                    <dd className="text-right font-mono">{formatCurrency(Number(postResult.total_out))}</dd>
                    <dt className="text-muted-foreground">Total in</dt>
                    <dd className="text-right font-mono">{formatCurrency(Number(postResult.total_in))}</dd>
                    <dt className="text-muted-foreground">Opening balance</dt>
                    <dd className="text-right font-mono">{formatCurrency(Number(postResult.opening_balance))}</dd>
                    <dt className="text-muted-foreground font-medium">Closing balance</dt>
                    <dd className="text-right font-mono font-medium">
                      {formatCurrency(Number(postResult.closing_balance))}
                    </dd>
                  </dl>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex gap-2">
              {step === 3 && batchId && !postResult && (
                <Button
                  variant="outline"
                  className="text-destructive"
                  onClick={() => setConfirmDiscard(true)}
                >
                  Discard &amp; start over
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {step === 2 && (
                <>
                  <Button variant="ghost" onClick={removeFile}>
                    Remove file
                  </Button>
                  <Button variant="outline" onClick={() => setStep(1)}>
                    Back
                  </Button>
                </>
              )}
              {step === 1 && (
                <Button
                  disabled={!parseResult || !fundId || parseResult.missingColumns.length > 0}
                  onClick={() => setStep(2)}
                >
                  Continue
                </Button>
              )}
              {step === 2 && (
                <Button disabled={conflicting || createBatch.isPending} onClick={() => void stageBatch()}>
                  {createBatch.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Staging…
                    </>
                  ) : (
                    "Stage & resolve"
                  )}
                </Button>
              )}
              {step === 3 && (
                <Button disabled={blockedCount > 0} onClick={() => setStep(4)}>
                  Continue
                </Button>
              )}
              {step === 4 && !postResult && (
                <>
                  <Button variant="outline" onClick={() => setStep(3)}>
                    Back
                  </Button>
                  <Button
                    disabled={postBatch.isPending}
                    onClick={() =>
                      batchId && postBatch.mutate(batchId, { onSuccess: (r) => setPostResult(r) })
                    }
                  >
                    {postBatch.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Posting…
                      </>
                    ) : (
                      "Post to ledger"
                    )}
                  </Button>
                </>
              )}
              {postResult && (
                <Button
                  onClick={() => {
                    setOpen(false);
                    resetAll();
                  }}
                >
                  Done
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discard the staged batch */}
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this import?</AlertDialogTitle>
            <AlertDialogDescription>
              {batch?.file_name} ({batch?.row_count} rows) is staged but has never touched the ledger. Discarding
              deletes the staged rows and records that the file was withdrawn. You can upload the same file again
              straight away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                batchId &&
                discardBatch.mutate(
                  { batchId, reason: "Discarded from the import wizard" },
                  { onSuccess: () => resetAll() },
                )
              }
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Closing with a staged batch */}
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This import is staged but not posted</AlertDialogTitle>
            <AlertDialogDescription>
              Keep it and you can resume from Petty Cash Imports with your edits intact. Discard it and the staged
              rows are deleted — nothing has reached the ledger either way.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmClose(false);
                  setOpen(false);
                  resetAll();
                }}
              >
                Keep for later
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  batchId &&
                  discardBatch.mutate(
                    { batchId, reason: "Discarded on closing the wizard" },
                    {
                      onSuccess: () => {
                        setConfirmClose(false);
                        setOpen(false);
                        resetAll();
                      },
                    },
                  )
                }
              >
                Discard
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Renders one raw date both ways so an ambiguous file can be judged by eye. */
function parseDatePreview(raw: string, format: "DD/MM/YYYY" | "MM/DD/YYYY"): string {
  const m = raw.match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/);
  if (!m) return raw;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [d, mo] = format === "MM/DD/YYYY" ? [b, a] : [a, b];
  const y = c < 100 ? c + 2000 : c;
  return `${String(d).padStart(2, "0")} ${
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo - 1] ?? "?"
  } ${y}`;
}
