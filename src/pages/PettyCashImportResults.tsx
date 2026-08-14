import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, CircleSlash, FileSpreadsheet, Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AccountSelector from "@/components/shared/AccountSelector";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  usePCImportBatch,
  usePCImportBatches,
  usePCImportLinesPaged,
  usePostPCImportBatch,
  useRectifyPCImportLine,
  useRestorePCImportLines,
  type PCImportLineFilter,
} from "@/hooks/usePettyCashImport";
import { useMyPermissions } from "@/hooks/usePermissions";
import { formatCurrency } from "@/lib/currency";

const PAGE_SIZE = 100;

const VIEWS: { key: PCImportLineFilter; label: string; countKey: string }[] = [
  { key: "all", label: "All rows", countKey: "total" },
  { key: "recognized", label: "Recognized", countKey: "recognized" },
  { key: "unrecognized", label: "Not recognized", countKey: "unrecognized" },
  { key: "suspense", label: "To suspense", countKey: "suspense" },
  { key: "blocked", label: "Blocked", countKey: "blocked" },
  { key: "duplicate", label: "Duplicates", countKey: "duplicates" },
  { key: "excluded", label: "Excluded", countKey: "excluded" },
];

const statusStyle: Record<string, string> = {
  ok: "border-success/40 text-success",
  posted: "border-success/40 text-success",
  suspense: "border-warning/40 text-warning",
  blocked: "border-destructive/40 text-destructive",
  excluded: "text-muted-foreground",
  pending: "text-muted-foreground",
};

/**
 * Persistent extraction results.
 *
 * Every value shown is read back from the staging tables, not from anything the
 * wizard held in memory — so this page is identical after a reload, in a second
 * browser tab, or a week later. The selected batch lives in the path and the
 * active view and page live in the query string, which is what makes switching
 * tabs and refreshing non-destructive.
 */
export default function PettyCashImportResults() {
  const { batchId } = useParams<{ batchId: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const view = (params.get("view") ?? "all") as PCImportLineFilter;
  const page = Math.max(0, Number(params.get("page") ?? "0") || 0);

  const { data: batches } = usePCImportBatches();
  const { data: batch, isLoading: batchLoading } = usePCImportBatch(batchId);
  const { data: paged, isFetching } = usePCImportLinesPaged(batchId, view, page, PAGE_SIZE);
  const { canEdit } = useMyPermissions();
  const editable = canEdit("banking");

  const rectify = useRectifyPCImportLine();
  const restore = useRestorePCImportLines();
  const postBatch = usePostPCImportBatch();

  // Which row is open for correction, and the edits in flight for it.
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixDate, setFixDate] = useState("");
  const [fixAccount, setFixAccount] = useState("");

  const counts = batch?.counts;
  const rows = paged?.rows ?? [];
  const total = paged?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function setView(next: PCImportLineFilter) {
    // Page resets with the view, but both stay in the URL so Back works and a
    // refresh lands on the same screen.
    setParams({ view: next, page: "0" }, { replace: true });
  }

  function setPage(next: number) {
    setParams({ view, page: String(next) }, { replace: true });
  }

  // Ready but not yet in the ledger — what a second post would pick up.
  const ready = (counts?.ok ?? 0) + (counts?.suspense ?? 0);

  function countFor(key: string): number {
    if (key === "total") return batch?.total ?? 0;
    return (counts as Record<string, number> | undefined)?.[key] ?? 0;
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 -ml-2 text-xs"
            onClick={() => navigate("/banking/petty-cash/imports")}
          >
            <ArrowLeft className="w-3 h-3 mr-1" /> Back to imports
          </Button>
          <h1 className="page-title flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            {batchLoading ? "Loading…" : (batch?.file_name ?? "Import results")}
          </h1>
          <p className="page-description">
            What the engine made of every row it read out of the sheet
          </p>
        </div>
        <div className="w-72">
          <Select value={batchId} onValueChange={(id) => navigate(`/banking/petty-cash/imports/${id}`)}>
            <SelectTrigger>
              <SelectValue placeholder="Choose an import" />
            </SelectTrigger>
            <SelectContent>
              {(batches ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.file_name} · {new Date(b.created_at).toLocaleDateString()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {batch && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-1">
              <CardDescription className="text-xs flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-success" /> Recognized
              </CardDescription>
              <CardTitle className="text-2xl text-success">{countFor("recognized")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-xs text-muted-foreground">
              matched to a real account
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardDescription className="text-xs flex items-center gap-1">
                <CircleSlash className="w-3 h-3 text-warning" /> Not recognized
              </CardDescription>
              <CardTitle className="text-2xl text-warning">{countFor("unrecognized")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-xs text-muted-foreground">
              blocked, or parked on suspense
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardDescription className="text-xs">Rows read</CardDescription>
              <CardTitle className="text-2xl">{batch.total}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-xs text-muted-foreground">
              of {batch.row_count} in the file
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardDescription className="text-xs">Status</CardDescription>
              <CardTitle className="text-2xl capitalize">{batch.status}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-xs text-muted-foreground">
              {batch.sheet_name} · {batch.date_format}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Rows held back at the last post are still owed to the ledger. Say so,
          and offer the one action that settles them. */}
      {editable && batchId && ready > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]">
            <p className="text-sm font-medium">
              {ready} row{ready === 1 ? "" : "s"} ready and not yet posted
            </p>
            <p className="text-xs text-muted-foreground">
              {batch?.status === "posted"
                ? "Corrected since this batch posted. Posting again adds only these rows — nothing already in the ledger is touched."
                : "Post the batch to send these to the ledger."}
            </p>
          </div>
          <Button
            size="sm"
            disabled={postBatch.isPending}
            onClick={() => postBatch.mutate(batchId)}
          >
            {postBatch.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Posting…
              </>
            ) : (
              `Post ${ready} row${ready === 1 ? "" : "s"}`
            )}
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap gap-1.5">
            {VIEWS.map((v) => (
              <Button
                key={v.key}
                size="sm"
                variant={view === v.key ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setView(v.key)}
              >
                {v.label}
                <Badge variant="secondary" className="ml-1.5 text-[10px] px-1">
                  {countFor(v.countKey)}
                </Badge>
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead className="h-8">Row</TableHead>
                  <TableHead className="h-8">Date</TableHead>
                  <TableHead className="h-8">Voucher No.</TableHead>
                  <TableHead className="h-8">Name</TableHead>
                  <TableHead className="h-8">Description</TableHead>
                  <TableHead className="h-8">Account Type (as written)</TableHead>
                  <TableHead className="h-8 text-right">Amount</TableHead>
                  <TableHead className="h-8">Result</TableHead>
                  <TableHead className="h-8">Posted to</TableHead>
                  <TableHead className="h-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-xs text-muted-foreground py-6">
                      {isFetching ? "Loading…" : "No rows in this view."}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((l) => {
                    const acct = (l as { accounts?: { account_code: string; account_name: string } })
                      .accounts;
                    const recognized =
                      l.resolution_tier !== "suspense" &&
                      l.status !== "blocked" &&
                      !!l.resolved_account_id;
                    return (
                      <TableRow key={l.id} className="text-xs align-top">
                        <TableCell className="py-1.5">{l.row_no}</TableCell>
                        <TableCell className="py-1.5 whitespace-nowrap">
                          {l.parsed_date ?? (
                            <span className="text-destructive font-mono">{l.raw_date}</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5">{l.raw_voucher_no}</TableCell>
                        <TableCell className="py-1.5">{l.raw_name}</TableCell>
                        <TableCell className="py-1.5">{l.raw_description}</TableCell>
                        <TableCell className="py-1.5">{l.raw_account_type}</TableCell>
                        <TableCell className="py-1.5 text-right font-mono whitespace-nowrap">
                          {l.amount === null
                            ? "—"
                            : `${l.direction === "in" ? "+" : "−"}${formatCurrency(Number(l.amount))}`}
                        </TableCell>
                        <TableCell className="py-1.5 space-y-0.5">
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="outline" className={statusStyle[l.status] ?? ""}>
                              {l.status}
                            </Badge>
                            {l.is_duplicate && (
                              <Badge variant="outline" className="border-warning/40 text-warning">
                                duplicate
                              </Badge>
                            )}
                          </div>
                          {l.error_code && (
                            <div className="text-destructive">
                              <span className="font-mono">{l.error_code}</span>
                              {l.error_message && <> — {l.error_message}</>}
                            </div>
                          )}
                          {!l.error_code && l.resolution_tier && (
                            <div className="text-muted-foreground">
                              matched by {l.resolution_tier.replace(/_/g, " ")}
                              {l.resolution_key && <> · “{l.resolution_key}”</>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5">
                          {acct ? (
                            <span className={recognized ? "" : "text-warning"}>
                              <span className="font-mono">{acct.account_code}</span>{" "}
                              {acct.account_name}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        {/* A posted row should reach what it became, rather
                            than leaving the reader to search for it. */}
                        <TableCell className="py-1.5 whitespace-nowrap text-right">
                          {editable && l.status !== "posted" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs"
                              onClick={() => {
                                setFixing(fixing === l.id ? null : l.id);
                                setFixDate(l.parsed_date ?? "");
                                setFixAccount(l.resolved_account_id ?? "");
                              }}
                            >
                              <Wrench className="w-3 h-3 mr-1" />
                              {l.status === "excluded" ? "Restore & fix" : "Fix"}
                            </Button>
                          )}
                          {l.voucher_id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs"
                              onClick={() => navigate(`/banking/petty-cash/voucher/${l.voucher_id}`)}
                            >
                              Voucher
                            </Button>
                          )}
                          {l.journal_entry_id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs"
                              onClick={() => navigate(`/accounting/journals/${l.journal_entry_id}`)}
                            >
                              Entry
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
                {/* Correction panel for the row being fixed. Date and account
                    only: amount is re-derived from the sheet on every resolve,
                    so an override here would be silently discarded. */}
                {rows.map((l) =>
                  fixing === l.id ? (
                    <TableRow key={`fix-${l.id}`} className="bg-muted/30">
                      <TableCell colSpan={10} className="py-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Date</Label>
                            <Input
                              type="date"
                              value={fixDate}
                              onChange={(e) => setFixDate(e.target.value)}
                              className="h-8 text-xs w-40"
                            />
                            <p className="text-[11px] text-muted-foreground">
                              Sheet says “{l.raw_date}” — that stays on record.
                            </p>
                          </div>
                          <div className="space-y-1 min-w-[240px] flex-1">
                            <Label className="text-xs">Account</Label>
                            <AccountSelector
                              value={fixAccount}
                              onChange={(id) => setFixAccount(id)}
                              placeholder="Pick an account…"
                            />
                          </div>
                          <div className="flex gap-2 pb-1">
                            <Button
                              size="sm"
                              className="h-8"
                              disabled={rectify.isPending || restore.isPending}
                              onClick={async () => {
                                if (!batchId) return;
                                if (l.status === "excluded") {
                                  await restore.mutateAsync({ lineIds: [l.id], batchId });
                                }
                                await rectify.mutateAsync({
                                  lineId: l.id,
                                  batchId,
                                  parsedDate: fixDate || null,
                                  accountId: fixAccount || null,
                                });
                                setFixing(null);
                              }}
                            >
                              Save &amp; re-check
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8" onClick={() => setFixing(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                        {l.error_message && (
                          <p className="text-xs text-destructive mt-2">{l.error_message}</p>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : null,
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {total === 0
                ? "No rows"
                : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span>
                Page {page + 1} of {pages}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                disabled={page + 1 >= pages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
