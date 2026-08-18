import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { usePaymentVouchers, useDeletePaymentVoucher } from "@/hooks/usePaymentVouchers";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { sortAccounts } from "@/lib/accountSort";
import { Plus, Search, Trash2, Eye, Edit, FileText, CalendarIcon, X, SlidersHorizontal } from "lucide-react";
import { useMyPermissions } from "@/hooks/usePermissions";
import PaymentVoucherForm from "@/components/payment-vouchers/PaymentVoucherForm";
import PaymentVoucherDetails from "@/components/payment-vouchers/PaymentVoucherDetails";
import { formatCurrency } from "@/lib/currency";
import { useSearchParams } from "react-router-dom";
import { formatDate } from "@/lib/format";

const STATUS_OPTIONS = ["all", "draft", "posted", "reversed", "voided"] as const;

export default function PaymentVouchers() {
  const { data: vouchers, isLoading } = usePaymentVouchers();
  const deleteMutation = useDeletePaymentVoucher();
  const { canEdit: canEditBanking, canDelete: canDeleteBanking } = useMyPermissions();
  const { isSuperAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight");

  // Search + filter state
  const [search, setSearch] = useState("");
  const [referenceFilter, setReferenceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentAccountFilter, setPaymentAccountFilter] = useState<string>("all");
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [showFilters, setShowFilters] = useState(false);

  // Modal state
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(highlightId);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (highlightId && vouchers?.some((v) => v.id === highlightId)) {
      setViewId(highlightId);
    }
  }, [highlightId, vouchers]);

  // Distinct payment accounts present in current voucher set (for the dropdown)
  const paymentAccountOptions = useMemo(() => {
    const map = new Map<string, { id: string; account_code: string; account_name: string }>();
    vouchers?.forEach((v: any) => {
      const id = v.payment_account_id;
      const acc = v.accounts;
      if (id && acc) {
        map.set(id, { id, account_code: acc.account_code, account_name: acc.account_name });
      }
    });
    return sortAccounts(Array.from(map.values())).map((a) => ({
      id: a.id,
      label: `${a.account_code} — ${a.account_name}`,
    }));
  }, [vouchers]);

  // Tenants list — only for Super Admin
  const { data: tenants } = useQuery({
    queryKey: ["tenants-for-filter"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, company_name")
        .order("company_name");
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    if (!vouchers) return [];
    const q = search.trim().toLowerCase();
    const refQ = referenceFilter.trim().toLowerCase();
    const fromTs = fromDate ? new Date(fromDate).setHours(0, 0, 0, 0) : null;
    const toTs = toDate ? new Date(toDate).setHours(23, 59, 59, 999) : null;

    return vouchers.filter((v: any) => {
      // Generic search
      if (q) {
        const hay = [
          v.voucher_number,
          v.cheque_number,
          v.reference_number,
          v.memo,
          v.customers?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      // Reference number (exact-substring)
      if (refQ && !(v.reference_number || "").toLowerCase().includes(refQ)) return false;

      // Status
      if (statusFilter !== "all" && v.status !== statusFilter) return false;

      // Payment account
      if (paymentAccountFilter !== "all" && v.payment_account_id !== paymentAccountFilter) return false;

      // Tenant (super admin only)
      if (isSuperAdmin && tenantFilter !== "all" && v.tenant_id !== tenantFilter) return false;

      // Date range (payment_date)
      if (fromTs || toTs) {
        if (!v.payment_date) return false;
        const ts = new Date(v.payment_date).getTime();
        if (fromTs && ts < fromTs) return false;
        if (toTs && ts > toTs) return false;
      }

      return true;
    });
  }, [vouchers, search, referenceFilter, statusFilter, paymentAccountFilter, tenantFilter, fromDate, toDate, isSuperAdmin]);

  const activeFilterCount =
    (referenceFilter ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (paymentAccountFilter !== "all" ? 1 : 0) +
    (isSuperAdmin && tenantFilter !== "all" ? 1 : 0) +
    (fromDate ? 1 : 0) +
    (toDate ? 1 : 0);

  const clearFilters = () => {
    setReferenceFilter("");
    setStatusFilter("all");
    setPaymentAccountFilter("all");
    setTenantFilter("all");
    setFromDate(undefined);
    setToDate(undefined);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payment Vouchers</h1>
          <p className="text-sm text-muted-foreground">Manage payment vouchers and track disbursements</p>
        </div>
        {canEditBanking("banking") && (
          <Button onClick={() => { setEditId(null); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-2" /> New Voucher
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search vouchers, payee, memo…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <Button
              variant={showFilters ? "default" : "outline"}
              size="sm"
              onClick={() => setShowFilters((s) => !s)}
              className="gap-2"
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filters
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>

            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5 text-muted-foreground">
                <X className="w-3.5 h-3.5" /> Clear
              </Button>
            )}

            <div className="ml-auto text-xs text-muted-foreground">
              {filtered.length} of {vouchers?.length ?? 0} vouchers
            </div>
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2 border-t">
              {/* Reference */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Reference number</label>
                <Input
                  placeholder="e.g. INV-2024-001"
                  value={referenceFilter}
                  onChange={(e) => setReferenceFilter(e.target.value)}
                />
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Payment account */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Payment account</label>
                <Select value={paymentAccountFilter} onValueChange={setPaymentAccountFilter}>
                  <SelectTrigger><SelectValue placeholder="All accounts" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All accounts</SelectItem>
                    {paymentAccountOptions.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Tenant (Super Admin only) */}
              {isSuperAdmin && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Tenant</label>
                  <Select value={tenantFilter} onValueChange={setTenantFilter}>
                    <SelectTrigger><SelectValue placeholder="All tenants" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All tenants</SelectItem>
                      {tenants?.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>{t.company_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* From date */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">From date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !fromDate && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {fromDate ? formatDate(fromDate) : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={fromDate}
                      onSelect={setFromDate}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* To date */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">To date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !toDate && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {toDate ? formatDate(toDate) : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={toDate}
                      onSelect={setToDate}
                      initialFocus
                      disabled={(date) => (fromDate ? date < fromDate : false)}
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher #</TableHead>
                  <TableHead>Payee</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Payment Account</TableHead>
                  <TableHead>Cheque #</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      {activeFilterCount > 0 || search
                        ? "No vouchers match your filters"
                        : "No payment vouchers found"}
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((v: any) => (
                  <TableRow key={v.id} className={highlightId === v.id ? "bg-accent/40" : ""}>
                    <TableCell className="font-mono font-medium">{v.voucher_number}</TableCell>
                    <TableCell>{v.customers?.name || "—"}</TableCell>
                    <TableCell>{formatDate(v.payment_date)}</TableCell>
                    <TableCell>{v.accounts?.account_name || "—"}</TableCell>
                    <TableCell>{v.cheque_number || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{v.reference_number || "—"}</TableCell>
                    <TableCell><Badge variant="outline">{v.payment_method}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(Number(v.total_amount))}</TableCell>
                    <TableCell>
                      <Badge variant={v.status === "posted" ? "default" : "secondary"}>{v.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setViewId(v.id)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canEditBanking("banking") && v.status === "draft" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => { setEditId(v.id); setShowForm(true); }}
                            title="Edit draft voucher"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteBanking("banking") && (
                          <Button variant="ghost" size="icon" onClick={() => setDeleteId(v.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Payment Voucher" : "Create Payment Voucher"}</DialogTitle>
          </DialogHeader>
          <PaymentVoucherForm
            editId={editId}
            onClose={() => { setShowForm(false); setEditId(null); }}
          />
        </DialogContent>
      </Dialog>

      {/* View Details Dialog */}
      <Dialog open={!!viewId} onOpenChange={() => setViewId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <PaymentVoucherDetails voucherId={viewId} />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payment Voucher?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The voucher and its line items will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId) deleteMutation.mutate(deleteId);
                setDeleteId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
