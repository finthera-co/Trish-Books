import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileSpreadsheet, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { PCImportDialog } from "@/components/petty-cash/PCImportDialog";
import {
  useDiscardPCImportBatch,
  usePCImportBatches,
  useRevertPCImportBatch,
  type PCImportBatch,
} from "@/hooks/usePettyCashImport";
import { useMyPermissions } from "@/hooks/usePermissions";
import { formatDate } from "@/lib/format";

type BatchRow = PCImportBatch & {
  petty_cash_accounts?: { account_name: string } | null;
  imported_user?: { first_name: string | null; last_name: string | null } | null;
};

const statusStyle: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  resolved: "bg-warning/10 text-warning",
  posted: "bg-success/10 text-success",
  reverted: "bg-muted text-muted-foreground line-through",
  failed: "bg-destructive/10 text-destructive",
};

export default function PettyCashImports() {
  const { data: batches, isLoading } = usePCImportBatches();
  const { canEdit } = useMyPermissions();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const resumeId = searchParams.get("resume");

  const discard = useDiscardPCImportBatch();
  const revert = useRevertPCImportBatch();

  const [toDiscard, setToDiscard] = useState<BatchRow | null>(null);
  const [toRevert, setToRevert] = useState<BatchRow | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [reason, setReason] = useState("");

  const rows = (batches ?? []) as BatchRow[];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Petty Cash Imports</h1>
          <p className="page-description">
            Every workbook staged for this tenant, and what happened to it
          </p>
        </div>
        {canEdit("banking") && <PCImportDialog />}
      </div>

      {/* Resume reopens the wizard on the staged batch, at the resolve step. */}
      <div className="hidden">
        <PCImportDialog
          resumeBatchId={resumeId}
          open={!!resumeId}
          onOpenChange={(o) => {
            if (!o) setSearchParams({}, { replace: true });
          }}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" /> Import history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No imports yet. Use <strong>Import Excel</strong> to stage a petty cash book.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="h-8">File</TableHead>
                    <TableHead className="h-8">Fund</TableHead>
                    <TableHead className="h-8 text-right">Rows</TableHead>
                    <TableHead className="h-8">Status</TableHead>
                    <TableHead className="h-8">Imported by</TableHead>
                    <TableHead className="h-8">Date</TableHead>
                    <TableHead className="h-8 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((b) => (
                    <TableRow key={b.id} className="text-xs">
                      <TableCell className="py-2">
                        <button
                          className="font-medium text-left hover:underline"
                          onClick={() => navigate(`/banking/petty-cash/imports/${b.id}`)}
                        >
                          {b.file_name}
                        </button>
                        <div className="text-muted-foreground">
                          {b.sheet_name} · {b.date_format} · {b.amount_orientation}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">{b.petty_cash_accounts?.account_name ?? "—"}</TableCell>
                      <TableCell className="py-2 text-right">{b.row_count}</TableCell>
                      <TableCell className="py-2">
                        <Badge className={statusStyle[b.status] ?? ""} variant="secondary">
                          {b.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        {b.imported_user
                          ? `${b.imported_user.first_name ?? ""} ${b.imported_user.last_name ?? ""}`.trim()
                          : "—"}
                      </TableCell>
                      <TableCell className="py-2 whitespace-nowrap">
                        {formatDate(b.created_at)}
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex justify-end gap-1">
                          {canEdit("banking") && (b.status === "draft" || b.status === "resolved") && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs"
                                onClick={() => setSearchParams({ resume: b.id }, { replace: true })}
                              >
                                Resume
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs text-destructive"
                                onClick={() => setToDiscard(b)}
                              >
                                Discard
                              </Button>
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs"
                            onClick={() => navigate(`/banking/petty-cash/imports/${b.id}`)}
                          >
                            Results
                          </Button>
                          {b.status === "posted" && (
                            <>
                              {/* The batch's own posted rows, each linking to
                                  the voucher it became — not the whole petty
                                  cash page, which is where this used to land. */}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs"
                                onClick={() =>
                                  navigate(`/banking/petty-cash/imports/${b.id}?view=recognized&page=0`)
                                }
                              >
                                View vouchers
                              </Button>
                              {canEdit("banking") && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-xs text-destructive"
                                  onClick={() => {
                                    setToRevert(b);
                                    setConfirmName("");
                                    setReason("");
                                  }}
                                >
                                  <Undo2 className="w-3 h-3 mr-1" /> Reverse import
                                </Button>
                              )}
                            </>
                          )}
                          {canEdit("banking") && (b.status === "reverted" || b.status === "failed") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs"
                              onClick={() => setToDiscard(b)}
                            >
                              {b.status === "reverted" ? "Remove from history" : "Discard"}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Discard — nothing has been posted, so no typed confirmation. */}
      <AlertDialog open={!!toDiscard} onOpenChange={(o) => !o && setToDiscard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toDiscard?.status === "reverted" ? "Remove this import from history?" : "Discard this import?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toDiscard?.status === "reverted" ? (
                <>
                  {toDiscard?.file_name} has already been reversed, so its ledger effect is neutralised. Removing it
                  deletes only the staging record — the vouchers, journal entries and reversal entries all stay
                  exactly as they are.
                </>
              ) : (
                <>
                  {toDiscard?.file_name} ({toDiscard?.row_count} rows) has never touched the ledger. Discarding
                  deletes the staged rows and records that the file was withdrawn. You can upload the same file
                  again straight away.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                toDiscard &&
                discard.mutate(
                  { batchId: toDiscard.id, reason: "Discarded from import history" },
                  { onSuccess: () => setToDiscard(null) },
                )
              }
            >
              {toDiscard?.status === "reverted" ? "Remove" : "Discard"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reverse — this writes to the ledger, so it takes a typed confirmation. */}
      <AlertDialog open={!!toRevert} onOpenChange={(o) => !o && setToRevert(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverse this import?</AlertDialogTitle>
            <AlertDialogDescription>
              This writes a mirror-image journal entry for everything {toRevert?.file_name} posted and marks its
              vouchers reversed. Nothing is deleted — both the original and the correcting entries stay in the
              ledger. Afterwards the file can be uploaded again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Reason</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this being reversed?"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Type <span className="font-mono">{toRevert?.file_name}</span> to confirm
              </Label>
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmName !== toRevert?.file_name || !reason.trim() || revert.isPending}
              onClick={() =>
                toRevert &&
                revert.mutate(
                  { batchId: toRevert.id, reason: reason.trim() },
                  { onSuccess: () => setToRevert(null) },
                )
              }
            >
              Reverse import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
