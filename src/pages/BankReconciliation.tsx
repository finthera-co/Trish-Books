import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useBankReconciliations, useUndoReconciliation } from "@/hooks/useBankReconciliation";
import { formatCurrency } from "@/lib/currency";
import ReconciliationSetup from "@/components/bank-reconciliation/ReconciliationSetup";
import ReconciliationWorkspace from "@/components/bank-reconciliation/ReconciliationWorkspace";
import { Landmark, Plus, RotateCcw, Eye } from "lucide-react";
import { useMyPermissions } from "@/hooks/usePermissions";

type View = "list" | "setup" | "workspace";

export default function BankReconciliation() {
  const [view, setView] = useState<View>("list");
  const [activeReconId, setActiveReconId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { data: reconciliations, isLoading } = useBankReconciliations();
  const undoRecon = useUndoReconciliation();
  const { canEdit: canEditBanking } = useMyPermissions();

  const filtered = (reconciliations || []).filter((r: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (r.accounts?.account_name || "").toLowerCase().includes(s) ||
      r.status.toLowerCase().includes(s)
    );
  });

  if (view === "setup") {
    return (
      <div className="p-6">
        <ReconciliationSetup
          onStarted={(id) => { setActiveReconId(id); setView("workspace"); }}
          onCancel={() => setView("list")}
        />
      </div>
    );
  }

  if (view === "workspace" && activeReconId) {
    return (
      <div className="p-6">
        <ReconciliationWorkspace
          reconciliationId={activeReconId}
          onBack={() => { setActiveReconId(null); setView("list"); }}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Landmark className="w-6 h-6 text-primary" />
            Bank Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compare bank statements with your general ledger
          </p>
        </div>
        <Button onClick={() => setView("setup")}>
          <Plus className="w-4 h-4 mr-1" /> New Reconciliation
        </Button>
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <Input
          placeholder="Search by account or status..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {/* List */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bank Account</TableHead>
                <TableHead>Statement Date</TableHead>
                <TableHead className="text-right">Beginning Balance</TableHead>
                <TableHead className="text-right">Statement Balance</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No reconciliations found. Click "New Reconciliation" to start.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.accounts?.account_name}</TableCell>
                    <TableCell>{r.statement_ending_date}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.beginning_balance)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.statement_ending_balance)}</TableCell>
                    <TableCell className="text-right">
                      <span className={r.status === "reconciled" ? "text-green-600" : "text-red-600"}>
                        {formatCurrency(r.difference)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === "reconciled" ? "default" : "secondary"}>
                        {r.status === "reconciled" ? "Reconciled" : "In Progress"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setActiveReconId(r.id); setView("workspace"); }}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {r.status === "reconciled" && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-orange-600">
                                <RotateCcw className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Undo Reconciliation?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will reopen the reconciliation and unmark all cleared transactions. This action will be logged in the audit trail.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => undoRecon.mutate(r.id)}>
                                  Undo
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
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
