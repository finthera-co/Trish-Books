import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Lock, Unlock, Calendar, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { formatDate, formatDateTime } from "@/lib/format";
import {
  useFiscalPeriods,
  useCloseFiscalPeriod,
  useReopenFiscalPeriod,
} from "@/hooks/useFiscalPeriodBalances";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function FiscalPeriods() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  const { data: periods, isLoading } = useFiscalPeriods();
  const closePeriod = useCloseFiscalPeriod();
  const reopenPeriod = useReopenFiscalPeriod();

  const createPeriod = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fiscal_periods").insert({
        tenant_id: appUser?.tenant_id,
        name,
        period_start: periodStart,
        period_end: periodEnd,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiscal_periods"] });
      toast.success("Fiscal period created");
      setOpen(false);
      setName("");
      setPeriodStart("");
      setPeriodEnd("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Fiscal Periods</h1>
          <p className="page-description">Manage accounting periods, close periods, and carry forward balances</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" /> New Period</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Fiscal Period</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm font-medium">Period Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground"
                  placeholder="FY 2026 Q1" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Start Date</label>
                  <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
                <div>
                  <label className="text-sm font-medium">End Date</label>
                  <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
              </div>
              <Button onClick={() => createPeriod.mutate()} disabled={!name || !periodStart || !periodEnd || createPeriod.isPending} className="w-full">
                {createPeriod.isPending ? "Creating..." : "Create Period"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Info banner about auto-carry */}
      <div className="bg-info/10 text-info text-xs font-medium px-4 py-2.5 rounded-lg flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        When you close a period, closing balances are automatically carried forward as the next period's opening balances. Revenue &amp; Expense accounts close to Retained Earnings.
      </div>

      <div className="stat-card">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : !periods?.length ? (
          <div className="text-center py-16">
            <Calendar className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No fiscal periods defined</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first fiscal period to enable period management.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Period Name</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Status</th>
                <th>Closed By</th>
                <th>Closed At</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p: any) => (
                <tr key={p.id}>
                  <td className="font-medium text-foreground">{p.name}</td>
                  <td className="text-muted-foreground">{formatDate(p.period_start)}</td>
                  <td className="text-muted-foreground">{formatDate(p.period_end)}</td>
                  <td>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      p.status === "closed"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-success/10 text-success"
                    }`}>
                      {p.status === "closed" ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      {p.status}
                    </span>
                  </td>
                  <td className="text-muted-foreground text-sm">
                    {p.users ? `${p.users.first_name} ${p.users.last_name}` : "—"}
                  </td>
                  <td className="text-muted-foreground text-sm">
                    {p.closed_at ? formatDateTime(p.closed_at) : "—"}
                  </td>
                  <td className="text-right">
                    {p.status === "open" ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" disabled={closePeriod.isPending}>
                            <Lock className="w-3 h-3 mr-1" /> Close Period
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Close "{p.name}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will:
                              <ul className="list-disc ml-5 mt-2 space-y-1">
                                <li>Calculate closing balances for all accounts</li>
                                <li>Close Revenue &amp; Expense accounts to Retained Earnings</li>
                                <li>Carry forward balance sheet accounts to the next period</li>
                                <li>Lock this period from further entries</li>
                              </ul>
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => closePeriod.mutate(p.id)}>
                              Close Period
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" disabled={reopenPeriod.isPending}>
                            <Unlock className="w-3 h-3 mr-1" /> Reopen
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Reopen "{p.name}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This is not recommended for audited periods. Reopening will allow new transactions
                              to be posted to this period, but carry-forward balances for later periods will not
                              be automatically recalculated.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => reopenPeriod.mutate(p.id)}>
                              Reopen
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
