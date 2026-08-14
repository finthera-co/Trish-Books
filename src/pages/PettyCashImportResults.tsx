import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, CircleSlash, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  usePCImportBatch,
  usePCImportBatches,
  usePCImportLinesPaged,
  type PCImportLineFilter,
} from "@/hooks/usePettyCashImport";
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
