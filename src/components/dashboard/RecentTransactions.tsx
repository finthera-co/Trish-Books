import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ArrowUpRight, ArrowDownLeft, FileText, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";

interface TransactionItem {
  id: string;
  date: string;
  description: string;
  account: string;
  amount: number;
  type: "debit" | "credit";
  source: "journal" | "pcv" | "payment";
}

function useRecentTransactions() {
  return useQuery({
    queryKey: ["recent-transactions"],
    queryFn: async () => {
      const items: TransactionItem[] = [];

      // Recent journal entries with their lines
      const { data: journals } = await supabase
        .from("journal_entries")
        .select("id, entry_date, description, status, journal_lines(debit, credit, accounts(account_name))")
        .eq("status", "posted")
        .order("entry_date", { ascending: false })
        .limit(10);

      for (const je of journals || []) {
        for (const line of (je.journal_lines as any[]) || []) {
          const isDebit = Number(line.debit) > 0;
          items.push({
            id: `je-${je.id}-${line.accounts?.account_name}-${isDebit ? "dr" : "cr"}`,
            date: je.entry_date,
            description: je.description,
            account: line.accounts?.account_name || "—",
            amount: isDebit ? Number(line.debit) : Number(line.credit),
            type: isDebit ? "debit" : "credit",
            source: "journal",
          });
        }
      }

      // Recent petty cash vouchers
      const { data: pcvs } = await supabase
        .from("petty_cash_vouchers")
        .select("id, date, paid_to, total_amount, voucher_number")
        .order("date", { ascending: false })
        .limit(5);

      for (const pcv of pcvs || []) {
        items.push({
          id: `pcv-${pcv.id}`,
          date: pcv.date,
          description: `PCV ${pcv.voucher_number} — ${pcv.paid_to || ""}`,
          account: "Petty Cash",
          amount: Number(pcv.total_amount),
          type: "debit",
          source: "pcv",
        });
      }

      // Recent payments received
      const { data: payments } = await supabase
        .from("payments_received")
        .select("id, payment_date, amount, reference, payment_method, invoices(invoice_number)")
        .order("payment_date", { ascending: false })
        .limit(5);

      for (const p of payments || []) {
        items.push({
          id: `pay-${p.id}`,
          date: typeof p.payment_date === "string" ? p.payment_date.split("T")[0] : p.payment_date,
          description: `Payment — ${(p.invoices as any)?.invoice_number || p.reference || "Receipt"}`,
          account: p.payment_method || "Bank",
          amount: Number(p.amount),
          type: "credit",
          source: "payment",
        });
      }

      // Sort by date desc, take top 15
      items.sort((a, b) => b.date.localeCompare(a.date));
      return items.slice(0, 6);
    },
    staleTime: 30_000,
  });
}

const sourceBadge = {
  journal: { label: "Journal", className: "bg-primary/10 text-primary border-primary/20" },
  pcv: { label: "PCV", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  payment: { label: "Payment", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
};

export default function RecentTransactions() {
  const { data: transactions, isLoading } = useRecentTransactions();

  return (
    <Card className="animate-fade-in">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <FileText className="w-4 h-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold">Recent Transactions</CardTitle>
            <p className="text-[11px] text-muted-foreground">Live activity feed</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !transactions?.length ? (
          <p className="text-xs text-muted-foreground text-center py-6">No recent transactions</p>
        ) : (
          <div className="space-y-1">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/50 transition-colors group"
              >
                {/* Dr/Cr Icon */}
                <div className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
                  tx.type === "debit" ? "bg-rose-500/10" : "bg-emerald-500/10"
                )}>
                  {tx.type === "debit" ? (
                    <ArrowUpRight className="w-3.5 h-3.5 text-rose-500" />
                  ) : (
                    <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{tx.description}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{tx.account}</p>
                </div>

                {/* Source badge */}
                <Badge variant="outline" className={cn("text-[10px] h-5 px-1.5 shrink-0", sourceBadge[tx.source].className)}>
                  {sourceBadge[tx.source].label}
                </Badge>

                {/* Amount */}
                <div className="text-right shrink-0 min-w-[80px]">
                  <p className={cn(
                    "text-xs font-semibold tabular-nums",
                    tx.type === "debit" ? "text-rose-600" : "text-emerald-600"
                  )}>
                    {tx.type === "debit" ? "Dr" : "Cr"} {formatCurrency(tx.amount)}
                  </p>
                  <p className="text-[10px] text-muted-foreground tabular-nums">
                    {format(new Date(tx.date), "MMM d, yyyy")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
