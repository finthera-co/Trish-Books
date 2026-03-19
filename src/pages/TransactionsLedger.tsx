import { useState } from "react";
import { useTransactions, useDailyBalances, useMonthlyFinancials } from "@/hooks/useTransactions";
import { useInsights } from "@/hooks/useInsights";
import { format, subMonths } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowUpRight, ArrowDownRight, Database, TrendingUp, Brain, AlertTriangle, Activity } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

function useAnomaliesList() {
  return useQuery({
    queryKey: ["anomalies_list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anomalies")
        .select("*, transactions(date, amount, type, description, source_type)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

function useCashflowForecastData() {
  return useQuery({
    queryKey: ["cashflow_forecast_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cashflow_forecast")
        .select("*")
        .order("date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

const SOURCE_LABELS: Record<string, string> = {
  journal_entry: "Journal Entry",
  expense: "Expense",
  invoice_payment: "Invoice Payment",
  payment_voucher: "Payment Voucher",
  petty_cash: "Petty Cash",
  manual: "Manual",
};

export default function TransactionsLedger() {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const from = format(subMonths(new Date(), 6), "yyyy-MM-dd");
  const to = format(new Date(), "yyyy-MM-dd");

  const { data: transactions, isLoading: txLoading } = useTransactions({
    from,
    to,
    type: typeFilter === "all" ? undefined : typeFilter,
  });
  const { data: dailyBalances, isLoading: dbLoading } = useDailyBalances(from, to);
  const { data: monthlyFinancials, isLoading: mfLoading } = useMonthlyFinancials();
  const { data: insights, isLoading: insLoading } = useInsights();
  const { data: anomalies, isLoading: anomLoading } = useAnomaliesList();
  const { data: forecasts, isLoading: fcLoading } = useCashflowForecastData();

  const filtered = (transactions || []).filter((tx: any) => {
    if (sourceFilter !== "all" && tx.source_type !== sourceFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        tx.description?.toLowerCase().includes(q) ||
        tx.category?.toLowerCase().includes(q) ||
        tx.source_type?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="w-full px-4 sm:px-5 py-5 space-y-5 overflow-y-auto flex-1">
      <div>
        <p className="text-xs font-medium text-primary mb-1">Intelligence → Transaction Sync</p>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Intelligence Hub</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View all synced transactions, daily balances, insights, anomalies & forecasts
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard
          icon={<Database className="w-4 h-4" />}
          label="Synced Transactions"
          value={transactions?.length ?? 0}
          loading={txLoading}
          color="text-primary"
        />
        <SummaryCard
          icon={<Activity className="w-4 h-4" />}
          label="Daily Snapshots"
          value={dailyBalances?.length ?? 0}
          loading={dbLoading}
          color="text-chart-2"
        />
        <SummaryCard
          icon={<Brain className="w-4 h-4" />}
          label="Insights"
          value={insights?.length ?? 0}
          loading={insLoading}
          color="text-chart-3"
        />
        <SummaryCard
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Anomalies"
          value={anomalies?.length ?? 0}
          loading={anomLoading}
          color="text-destructive"
        />
        <SummaryCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Forecast Points"
          value={forecasts?.length ?? 0}
          loading={fcLoading}
          color="text-chart-5"
        />
      </div>

      <Tabs defaultValue="transactions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="daily">Daily Balances</TabsTrigger>
          <TabsTrigger value="monthly">Monthly Financials</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
          <TabsTrigger value="forecast">Forecast</TabsTrigger>
        </TabsList>

        {/* TRANSACTIONS TAB */}
        <TabsContent value="transactions">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Synced Transactions</CardTitle>
              <CardDescription>Auto-synced from journal entries, expenses, invoices, payment vouchers & petty cash</CardDescription>
              <div className="flex flex-wrap gap-2 pt-2">
                <Input placeholder="Search..." className="w-48 h-8 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    <SelectItem value="journal_entry">Journal Entry</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                    <SelectItem value="invoice_payment">Invoice Payment</SelectItem>
                    <SelectItem value="payment_voucher">Payment Voucher</SelectItem>
                    <SelectItem value="petty_cash">Petty Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {txLoading ? <LoadingState /> : filtered.length === 0 ? (
                <EmptyState message="No synced transactions yet. Post a journal entry or approve an expense to see data flow here." />
              ) : (
                <div className="overflow-auto max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs">Type</TableHead>
                        <TableHead className="text-xs">Source</TableHead>
                        <TableHead className="text-xs">Account</TableHead>
                        <TableHead className="text-xs">Category</TableHead>
                        <TableHead className="text-xs">Description</TableHead>
                        <TableHead className="text-xs text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((tx: any) => (
                        <TableRow key={tx.id}>
                          <TableCell className="text-xs font-mono">{format(new Date(tx.date), "dd MMM yyyy")}</TableCell>
                          <TableCell>
                            <Badge variant={tx.type === "income" ? "default" : "destructive"} className="text-[10px] gap-1">
                              {tx.type === "income" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                              {tx.type}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">
                              {SOURCE_LABELS[tx.source_type || "manual"] || tx.source_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{tx.accounts?.account_code} – {tx.accounts?.account_name || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{tx.category || "—"}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate">{tx.description || "—"}</TableCell>
                          <TableCell className={`text-xs text-right font-mono font-medium ${tx.type === "income" ? "text-emerald-600" : "text-destructive"}`}>
                            {formatCurrency(tx.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* DAILY BALANCES TAB */}
        <TabsContent value="daily">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Daily Balance Snapshots</CardTitle>
              <CardDescription>Auto-computed closing balances from the transactions trigger</CardDescription>
            </CardHeader>
            <CardContent>
              {dbLoading ? <LoadingState /> : !dailyBalances?.length ? (
                <EmptyState message="No daily balance data yet. Transactions will auto-generate these snapshots." />
              ) : (
                <div className="overflow-auto max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs text-right">Closing Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dailyBalances.map((d: any) => (
                        <TableRow key={d.id}>
                          <TableCell className="text-xs font-mono">{format(new Date(d.date), "dd MMM yyyy")}</TableCell>
                          <TableCell className={`text-xs text-right font-mono font-medium ${d.closing_balance >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                            {formatCurrency(d.closing_balance)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MONTHLY FINANCIALS TAB */}
        <TabsContent value="monthly">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Monthly Financials</CardTitle>
              <CardDescription>Aggregated monthly income, expense & net from the database view</CardDescription>
            </CardHeader>
            <CardContent>
              {mfLoading ? <LoadingState /> : !monthlyFinancials?.length ? (
                <EmptyState message="No monthly financial data yet. Transactions auto-aggregate into this view." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Month</TableHead>
                      <TableHead className="text-xs text-right">Income</TableHead>
                      <TableHead className="text-xs text-right">Expense</TableHead>
                      <TableHead className="text-xs text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlyFinancials.map((m: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-mono">{format(new Date(m.month), "MMM yyyy")}</TableCell>
                        <TableCell className="text-xs text-right font-mono text-emerald-600">{formatCurrency(m.total_income)}</TableCell>
                        <TableCell className="text-xs text-right font-mono text-destructive">{formatCurrency(m.total_expense)}</TableCell>
                        <TableCell className={`text-xs text-right font-mono font-medium ${m.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                          {formatCurrency(m.net)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* INSIGHTS TAB */}
        <TabsContent value="insights">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">AI Insights</CardTitle>
              <CardDescription>Generated financial health alerts and recommendations</CardDescription>
            </CardHeader>
            <CardContent>
              {insLoading ? <LoadingState /> : !insights?.length ? (
                <EmptyState message="No insights generated yet. Run the insights engine after posting transactions." />
              ) : (
                <div className="space-y-2">
                  {insights.map((ins) => (
                    <div key={ins.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                      <Badge variant={ins.severity === "critical" ? "destructive" : ins.severity === "warning" ? "secondary" : "outline"} className="text-[10px] mt-0.5 shrink-0">
                        {ins.severity}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-xs font-medium">{ins.type}</p>
                        <p className="text-xs text-muted-foreground">{ins.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{format(new Date(ins.created_at), "dd MMM yyyy HH:mm")}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ANOMALIES TAB */}
        <TabsContent value="anomalies">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Anomaly Detection</CardTitle>
              <CardDescription>Flagged transactions with Z-score {">"} 3 (statistical outliers)</CardDescription>
            </CardHeader>
            <CardContent>
              {anomLoading ? <LoadingState /> : !anomalies?.length ? (
                <EmptyState message="No anomalies detected. The engine runs daily or can be triggered manually." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Z-Score</TableHead>
                      <TableHead className="text-xs">Reason</TableHead>
                      <TableHead className="text-xs">Transaction</TableHead>
                      <TableHead className="text-xs text-right">Amount</TableHead>
                      <TableHead className="text-xs">Detected</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {anomalies.map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <Badge variant={a.status === "pending" ? "destructive" : "outline"} className="text-[10px]">{a.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono font-bold">{Number(a.score).toFixed(2)}</TableCell>
                        <TableCell className="text-xs max-w-[250px] truncate">{a.reason}</TableCell>
                        <TableCell className="text-xs">{a.transactions?.description || "—"}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{a.transactions ? formatCurrency(a.transactions.amount) : "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{format(new Date(a.created_at), "dd MMM yyyy")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* FORECAST TAB */}
        <TabsContent value="forecast">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Cash Flow Forecast</CardTitle>
              <CardDescription>30-day predictive forecast based on linear regression</CardDescription>
            </CardHeader>
            <CardContent>
              {fcLoading ? <LoadingState /> : !forecasts?.length ? (
                <EmptyState message="No forecast data yet. Run the forecast engine after building daily balance history." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs text-right">Predicted Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {forecasts.map((f: any) => (
                      <TableRow key={f.id}>
                        <TableCell className="text-xs font-mono">{format(new Date(f.date), "dd MMM yyyy")}</TableCell>
                        <TableCell className={`text-xs text-right font-mono font-medium ${f.predicted_balance >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                          {formatCurrency(f.predicted_balance)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({ icon, label, value, loading, color }: { icon: React.ReactNode; label: string; value: number; loading: boolean; color: string }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className={`${color}`}>{icon}</div>
        <div>
          <p className="text-[10px] text-muted-foreground">{label}</p>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <p className="text-lg font-bold">{value}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Database className="w-10 h-10 text-muted-foreground/30 mb-3" />
      <p className="text-sm text-muted-foreground max-w-md">{message}</p>
    </div>
  );
}
