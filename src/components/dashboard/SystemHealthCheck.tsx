import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, AlertTriangle, AlertCircle, Shield, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HealthItem {
  label: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

function useSystemHealth() {
  return useQuery({
    queryKey: ["system-health"],
    queryFn: async () => {
      const checks: HealthItem[] = [];

      // 1. Trial Balance check — sum of all posted debits vs credits
      const { data: lines } = await supabase
        .from("journal_lines")
        .select("debit, credit, journal_entry_id, journal_entries!inner(status)")
        .eq("journal_entries.status", "posted");

      const totalDebit = (lines || []).reduce((s, l) => s + Number(l.debit), 0);
      const totalCredit = (lines || []).reduce((s, l) => s + Number(l.credit), 0);
      const diff = Math.abs(totalDebit - totalCredit);

      checks.push({
        label: "Trial Balance",
        status: diff < 0.01 ? "pass" : "fail",
        detail: diff < 0.01
          ? `Balanced — Dr ${totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 })} = Cr ${totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
          : `Off by ${diff.toFixed(2)}`,
      });

      // 2. Orphan journal entries (posted entries with no lines)
      const { data: entries } = await supabase
        .from("journal_entries")
        .select("id, journal_lines(id)")
        .eq("status", "posted");

      const orphans = (entries || []).filter((e) => !e.journal_lines || (e.journal_lines as any[]).length === 0);
      checks.push({
        label: "No Orphan Journal Entries",
        status: orphans.length === 0 ? "pass" : "fail",
        detail: orphans.length === 0
          ? "All posted entries have line items"
          : `${orphans.length} posted entries with no lines`,
      });

      // 3. All payment vouchers posted
      const { data: vouchers } = await supabase
        .from("payment_vouchers")
        .select("id, status")
        .neq("status", "voided");

      const unposted = (vouchers || []).filter((v) => v.status === "draft");
      checks.push({
        label: "All Vouchers Posted",
        status: unposted.length === 0 ? "pass" : "warn",
        detail: unposted.length === 0
          ? "All vouchers are posted or approved"
          : `${unposted.length} draft voucher(s) pending`,
      });

      // 4. Petty cash vouchers check
      const { data: pcvs } = await supabase
        .from("petty_cash_vouchers")
        .select("id, status")
        .neq("status", "voided");

      const pcvDraft = (pcvs || []).filter((v) => v.status === "draft");
      checks.push({
        label: "Petty Cash Vouchers Posted",
        status: pcvDraft.length === 0 ? "pass" : "warn",
        detail: pcvDraft.length === 0
          ? "All petty cash vouchers processed"
          : `${pcvDraft.length} draft PCV(s) pending`,
      });

      // 5. Active accounts have types
      const { data: accounts } = await supabase
        .from("accounts")
        .select("id, account_subtype")
        .eq("is_active", true);

      const noSubtype = (accounts || []).filter((a) => !a.account_subtype);
      checks.push({
        label: "Account Detail Types Assigned",
        status: noSubtype.length === 0 ? "pass" : "warn",
        detail: noSubtype.length === 0
          ? "All active accounts have detail types"
          : `${noSubtype.length} account(s) missing detail type`,
      });

      return checks;
    },
    staleTime: 60_000,
  });
}

const statusIcon = {
  pass: <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success-ink))]" />,
  fail: <XCircle className="w-4 h-4 text-destructive" />,
  warn: <AlertTriangle className="w-4 h-4 text-[hsl(var(--warning-ink))]" />,
};

export default function SystemHealthCheck() {
  const { data: checks, isLoading, isError, refetch, isFetching } = useSystemHealth();

  const allPass = checks?.every((c) => c.status === "pass");

  return (
    <Card className="animate-fade-in">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center",
              allPass ? "bg-[hsl(var(--success))]/10" : "bg-[hsl(var(--warning))]/10"
            )}>
              <Shield className={cn("w-4 h-4", allPass ? "text-[hsl(var(--success-ink))]" : "text-[hsl(var(--warning-ink))]")} />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">System Health</CardTitle>
              <p className="text-[11px] text-muted-foreground">Data integrity checks</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isError ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <AlertCircle className="w-5 h-5 text-destructive" />
            <p className="text-xs text-muted-foreground">
              Integrity checks could not run — this is not a clean bill of health.
            </p>
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" onClick={() => void refetch()}>
              <RefreshCw className="w-3 h-3" /> Retry
            </Button>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {checks?.map((check, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-xs transition-colors",
                  check.status === "pass" && "bg-[hsl(var(--success))]/5",
                  check.status === "fail" && "bg-destructive/5",
                  check.status === "warn" && "bg-[hsl(var(--warning))]/5",
                )}
              >
                <div className="mt-0.5 shrink-0">{statusIcon[check.status]}</div>
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{check.label}</p>
                  <p className="text-muted-foreground mt-0.5 tabular-nums">{check.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
