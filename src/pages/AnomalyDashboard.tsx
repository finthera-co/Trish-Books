import { useState } from "react";
import { useAnomalies, useUpdateAnomalyStatus } from "@/hooks/useAnomalies";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  ShieldAlert,
  Eye,
} from "lucide-react";
import { format } from "date-fns";
import { formatDate } from "@/lib/format";

export default function AnomalyDashboard() {
  const [tab, setTab] = useState("pending");
  const { data: anomalies, isLoading } = useAnomalies(
    tab === "all" ? undefined : tab
  );
  const updateStatus = useUpdateAnomalyStatus();

  const pendingCount =
    anomalies?.filter((a) => a.status === "pending").length ?? 0;

  return (
    <div className="w-full px-4 sm:px-5 py-5 space-y-5 overflow-y-auto flex-1">
      <div className="animate-fade-in">
        <p className="text-xs font-medium text-primary mb-1">
          Intelligence → Anomaly Detection
        </p>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">
          Anomaly Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Transactions flagged by Z-score statistical analysis (threshold &gt; 3σ)
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <ShieldAlert className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {anomalies?.length ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">Total Flagged</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {pendingCount}
                </p>
                <p className="text-xs text-muted-foreground">Pending Review</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {(anomalies?.length ?? 0) - pendingCount}
                </p>
                <p className="text-xs text-muted-foreground">Reviewed</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs + Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Flagged Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="reviewed">Reviewed</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>

            <TabsContent value={tab}>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : !anomalies?.length ? (
                <div className="text-center py-12">
                  <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No anomalies found. Your transactions look healthy!
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Z-Score</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[80px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {anomalies.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {a.transactions?.date
                              ? formatDate(a.transactions.date)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">
                            {a.transactions?.description || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                a.transactions?.type === "expense"
                                  ? "border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
                                  : "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                              }
                            >
                              {a.transactions?.type || "—"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {a.transactions?.amount?.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            }) ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant="secondary"
                              className={
                                a.score > 5
                                  ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                                  : a.score > 3.5
                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                                  : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                              }
                            >
                              {a.score.toFixed(2)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs max-w-[250px] truncate text-muted-foreground">
                            {a.reason}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                a.status === "pending" ? "destructive" : "secondary"
                              }
                              className="text-[10px]"
                            >
                              {a.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {a.status === "pending" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs gap-1"
                                onClick={() =>
                                  updateStatus.mutate({
                                    id: a.id,
                                    status: "reviewed",
                                  })
                                }
                                disabled={updateStatus.isPending}
                              >
                                <Eye className="w-3 h-3" />
                                Review
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
