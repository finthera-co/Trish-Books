import { useMemo, useState } from "react";
import { Ban, Loader2, FileSpreadsheet, Landmark, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatCurrency } from "@/lib/currency";
import { useAccounts } from "@/hooks/useData";
import { useHeldLines, BLOCK_REASON_LABELS, type HeldLine } from "@/hooks/useBankStatementImport";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function periodOf(l: HeldLine): string {
  if (!l.period_month || !l.period_year) return "—";
  return `${MONTHS[l.period_month]} ${l.period_year}`;
}

function reasonInfo(reason: string) {
  return BLOCK_REASON_LABELS[reason] ?? {
    title: reason.replace(/_/g, " "),
    detail: "This row did not pass the import's validation gates.",
  };
}

/**
 * Held rows — every line an import refused to post, and why.
 *
 * Read straight from the database rather than from the post-import summary, so
 * the figures survive a refresh and a change of page. Read-only on purpose: a
 * held row is evidence about the source file, and the fix belongs in the
 * workbook, not in an edit box here.
 */
export default function HeldRows() {
  const { data: lines, isLoading } = useHeldLines();
  const { data: accounts } = useAccounts();
  const [reason, setReason] = useState<string>("all");
  const [bank, setBank] = useState<string>("all");

  const bankName = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of (accounts as any[] | undefined) ?? []) m.set(a.id, a.account_name);
    return m;
  }, [accounts]);

  const all = lines ?? [];

  const reasons = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of all) counts.set(l.block_reason, (counts.get(l.block_reason) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);

  const banks = useMemo(() => {
    const set = new Set<string>();
    for (const l of all) if (l.bank_account_id) set.add(l.bank_account_id);
    return [...set];
  }, [all]);

  const rows = useMemo(
    () => all.filter((l) =>
      (reason === "all" || l.block_reason === reason) &&
      (bank === "all" || l.bank_account_id === bank)
    ),
    [all, reason, bank]
  );

  const heldValue = rows.reduce((s, l) => s + Number(l.debit || 0) + Number(l.credit || 0), 0);

  function exportCsv() {
    const head = ["Bank", "File", "Period", "Sheet", "Row", "Date", "Description", "Name",
      "Voucher", "Account Type", "Debit", "Credit", "Reason"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = rows.map((l) => [
      bankName.get(l.bank_account_id ?? "") ?? "", l.file_name, periodOf(l), l.sheet_name, l.row_index,
      l.txn_date || l.raw_date, l.description, l.name, l.voucher_no, l.raw_account_type,
      l.debit, l.credit, reasonInfo(l.block_reason).title,
    ].map(esc).join(","));
    const url = URL.createObjectURL(new Blob([[head.map(esc).join(","), ...body].join("\n")],
      { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `held-rows-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading held rows…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Ban className="w-6 h-6 text-destructive" /> Held Rows
          </h1>
          <p className="text-sm text-muted-foreground">
            Rows an import read but refused to post, with the reason for each. Nothing here has
            reached the ledger, so no entry is affected — they are listed so every row of the
            statement is accounted for.
          </p>
        </div>
        {rows.length > 0 && (
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
          </Button>
        )}
      </div>

      {all.length === 0 ? (
        <Alert>
          <Ban className="h-4 w-4" />
          <AlertTitle>No held rows</AlertTitle>
          <AlertDescription className="text-sm">
            Every row of every import posted to a ledger or to Suspense. Nothing was refused.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card><CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Rows held</p>
              <p className="text-2xl font-bold text-destructive">{rows.length.toLocaleString()}</p>
              {rows.length !== all.length && (
                <p className="text-xs text-muted-foreground">of {all.length.toLocaleString()} total</p>
              )}
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Value not posted</p>
              <p className="text-2xl font-bold text-foreground">{formatCurrency(heldValue)}</p>
              <p className="text-xs text-muted-foreground">excluded from the ledger</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Distinct reasons</p>
              <p className="text-2xl font-bold text-foreground">{reasons.length}</p>
              <p className="text-xs text-muted-foreground">
                {reasons.map(([r]) => reasonInfo(r).title).join(" · ") || "—"}
              </p>
            </CardContent></Card>
          </div>

          <div className="flex flex-wrap gap-3">
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="w-[260px]"><SelectValue placeholder="All reasons" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All reasons ({all.length})</SelectItem>
                {reasons.map(([r, n]) => (
                  <SelectItem key={r} value={r}>{reasonInfo(r).title} ({n})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {banks.length > 1 && (
              <Select value={bank} onValueChange={setBank}>
                <SelectTrigger className="w-[220px]">
                  <Landmark className="w-3.5 h-3.5 mr-1.5" />
                  <SelectValue placeholder="All bank accounts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All bank accounts</SelectItem>
                  {banks.map((b) => (
                    <SelectItem key={b} value={b}>{bankName.get(b) ?? "Unknown"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {reasons.map(([r]) => (
            reason === "all" || reason === r ? (
              <Alert key={r}>
                <Ban className="h-4 w-4" />
                <AlertTitle className="text-sm">{reasonInfo(r).title}</AlertTitle>
                <AlertDescription className="text-xs">{reasonInfo(r).detail}</AlertDescription>
              </Alert>
            ) : null
          ))}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Held rows</CardTitle>
              <CardDescription>
                Row numbers are the line in the original sheet, so each can be found in the workbook.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Row</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Description / Name</TableHead>
                    <TableHead>Account Type</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">
                        <div className="font-medium">{bankName.get(l.bank_account_id ?? "") ?? "—"}</div>
                        <div className="text-muted-foreground flex items-center gap-1">
                          <FileSpreadsheet className="w-3 h-3" />
                          {l.sheet_name}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{periodOf(l)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{l.row_index}</TableCell>
                      <TableCell className="text-xs">
                        {l.txn_date || <span className="text-muted-foreground">{l.raw_date || "—"}</span>}
                      </TableCell>
                      <TableCell className="text-xs max-w-[280px]">
                        <div className="truncate">{l.description || <span className="text-muted-foreground">(blank)</span>}</div>
                        {l.name && <div className="text-muted-foreground truncate">{l.name}</div>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {l.raw_account_type || <span className="text-muted-foreground">(blank)</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {Number(l.debit) ? formatCurrency(Number(l.debit)) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {Number(l.credit) ? formatCurrency(Number(l.credit)) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="destructive" title={reasonInfo(l.block_reason).detail}>
                          {reasonInfo(l.block_reason).title}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
