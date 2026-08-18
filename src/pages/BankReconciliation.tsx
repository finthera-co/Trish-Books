import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBankReconciliations, useUndoReconciliation } from "@/hooks/useBankReconciliation";
import { formatCurrency } from "@/lib/currency";
import ReconciliationSetup from "@/components/bank-reconciliation/ReconciliationSetup";
import ReconciliationWorkspace from "@/components/bank-reconciliation/ReconciliationWorkspace";
import { Landmark, Plus, RotateCcw, Eye, Search, CheckCircle2, Clock } from "lucide-react";
import { useMyPermissions } from "@/hooks/usePermissions";
import { useSetHideSidebar } from "@/stores/useAppStore";
import { formatDate } from "@/lib/format";

type View = "list" | "setup" | "workspace";
type StatusFilter = "all" | "in_progress" | "reconciled";

export default function BankReconciliation() {
  const [view, setView] = useState<View>("list");
  const [activeReconId, setActiveReconId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const { data: reconciliations, isLoading } = useBankReconciliations();
  const undoRecon = useUndoReconciliation();
  const { canEdit: canEditBanking } = useMyPermissions();
  const setHideSidebar = useSetHideSidebar();

  useEffect(() => {
    const inWorkspace = view === "workspace";
    setHideSidebar(inWorkspace);
    return () => setHideSidebar(false);
  }, [view, setHideSidebar]);

  const list = reconciliations || [];

  const stats = useMemo(() => {
    const reconciled = list.filter((r: any) => r.status === "reconciled").length;
    const inProgress = list.length - reconciled;
    return { total: list.length, reconciled, inProgress };
  }, [list]);

  const filtered = list.filter((r: any) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (r.accounts?.account_name || "").toLowerCase().includes(s) ||
      (r.accounts?.account_code || "").toLowerCase().includes(s)
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
    <TooltipProvider delayDuration={200}>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Landmark className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground tracking-tight">
                Bank Reconciliation
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Match your bank statements to the general ledger
              </p>
            </div>
          </div>
          {canEditBanking("banking") && (
            <Button onClick={() => setView("setup")} size="sm">
              <Plus className="w-4 h-4 mr-1.5" /> New Reconciliation
            </Button>
          )}
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Total" value={stats.total} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
          <StatTile
            label="In Progress"
            value={stats.inProgress}
            icon={<Clock className="w-3.5 h-3.5" />}
            tone="warning"
            active={statusFilter === "in_progress"}
            onClick={() => setStatusFilter(statusFilter === "in_progress" ? "all" : "in_progress")}
          />
          <StatTile
            label="Reconciled"
            value={stats.reconciled}
            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
            tone="success"
            active={statusFilter === "reconciled"}
            onClick={() => setStatusFilter(statusFilter === "reconciled" ? "all" : "reconciled")}
          />
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by account name or code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {/* List */}
        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/60">
                  <TableHead className="text-xs font-medium uppercase tracking-wide">Bank Account</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wide">Statement Date</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wide text-right">Statement Balance</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wide text-right">Difference</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wide">Status</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wide text-right w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-sm">
                      Loading reconciliations…
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-16">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                          <Landmark className="w-5 h-5 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">No reconciliations yet</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Start a new reconciliation to match your bank statement to the ledger.
                          </p>
                        </div>
                        {canEditBanking("banking") && (
                          <Button size="sm" variant="outline" onClick={() => setView("setup")}>
                            <Plus className="w-4 h-4 mr-1.5" /> New Reconciliation
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r: any) => {
                    const isReconciled = r.status === "reconciled";
                    const diff = Number(r.difference || 0);
                    return (
                      <TableRow key={r.id} className="border-border/60">
                        <TableCell className="py-3">
                          <div className="font-medium text-sm text-foreground">{r.accounts?.account_name}</div>
                          {r.accounts?.account_code && (
                            <div className="text-xs text-muted-foreground mt-0.5">{r.accounts.account_code}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(r.statement_ending_date)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {formatCurrency(r.statement_ending_balance)}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          <span className={diff === 0 ? "text-muted-foreground" : "text-destructive font-medium"}>
                            {formatCurrency(diff)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              isReconciled
                                ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-900"
                                : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900"
                            }
                          >
                            {isReconciled ? (
                              <><CheckCircle2 className="w-3 h-3 mr-1" /> Reconciled</>
                            ) : (
                              <><Clock className="w-3 h-3 mr-1" /> In Progress</>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-0.5">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => { setActiveReconId(r.id); setView("workspace"); }}
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Open</TooltipContent>
                            </Tooltip>
                            {isReconciled && canEditBanking("banking") && (
                              <AlertDialog>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertDialogTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30">
                                        <RotateCcw className="w-4 h-4" />
                                      </Button>
                                    </AlertDialogTrigger>
                                  </TooltipTrigger>
                                  <TooltipContent>Undo reconciliation</TooltipContent>
                                </Tooltip>
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
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

function StatTile({
  label, value, icon, tone, active, onClick,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  tone?: "success" | "warning";
  active?: boolean;
  onClick?: () => void;
}) {
  const toneClasses =
    tone === "success"
      ? "text-green-600 dark:text-green-400"
      : tone === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : "text-foreground";
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border bg-card px-4 py-3 transition-all hover:border-primary/40 hover:shadow-sm ${
        active ? "border-primary/60 ring-1 ring-primary/20" : "border-border/60"
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon && <span className={toneClasses}>{icon}</span>}
        {label}
      </div>
      <div className={`text-2xl font-semibold mt-1 tabular-nums ${toneClasses}`}>{value}</div>
    </button>
  );
}
