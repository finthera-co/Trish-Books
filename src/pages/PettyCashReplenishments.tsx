import { useState, useMemo, useEffect } from "react";
import { CheckCircle, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  usePettyCashAccounts,
  useBankAccounts,
  usePCReplenishments,
  usePCBalance,
  useUnreimbursedVouchers,
  usePostImprestReplenishment,
} from "@/hooks/usePettyCash";
import { useMyPermissions } from "@/hooks/usePermissions";
import { PCFundDialog } from "@/components/petty-cash/PCFundDialog";
import { formatCurrency } from "@/lib/currency";
import AccountCombobox from "@/components/shared/AccountCombobox";
import { formatDate } from "@/lib/format";

export default function PettyCashReplenishments() {
  const [pcAccountId, setPcAccountId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [showPartial, setShowPartial] = useState(false);

  const { data: pcAccounts } = usePettyCashAccounts();
  const { data: bankAccounts } = useBankAccounts();
  const { data: replenishments } = usePCReplenishments();
  const { data: balance } = usePCBalance(pcAccountId || undefined);
  const { data: vouchers } = useUnreimbursedVouchers(pcAccountId || undefined);
  const postImprest = usePostImprestReplenishment();
  const { canEdit } = useMyPermissions();

  const account = pcAccounts?.find((a) => a.id === pcAccountId);
  const float = Number(account?.float_amount || 0);
  const currentBalance = Number(balance?.remaining || 0);

  // Default every voucher to checked whenever the batch changes.
  useEffect(() => {
    if (vouchers) {
      setChecked(Object.fromEntries(vouchers.map((v) => [v.voucher_id, true])));
      setShowPartial(false);
    }
  }, [vouchers]);

  const checkedVouchers = useMemo(
    () => (vouchers || []).filter((v) => checked[v.voucher_id]),
    [vouchers, checked],
  );
  const topup = useMemo(
    () => checkedVouchers.reduce((s, v) => s + Number(v.total_amount), 0),
    [checkedVouchers],
  );
  const balanceAfter = Number((currentBalance + topup).toFixed(2));
  const restoresToFloat = Math.abs(balanceAfter - float) <= 0.01;
  const allChecked = !!vouchers?.length && checkedVouchers.length === vouchers.length;

  const resetForm = () => {
    setPcAccountId("");
    setBankAccountId("");
    setChecked({});
    setShowPartial(false);
  };

  const doPost = (allowPartial: boolean) => {
    if (!pcAccountId || !bankAccountId || !checkedVouchers.length) return;
    postImprest.mutate(
      {
        pc_account_id: pcAccountId,
        bank_account_id: bankAccountId,
        date,
        // Pass ids only when reimbursing a subset; otherwise reimburse all.
        voucher_ids: allChecked ? undefined : checkedVouchers.map((v) => v.voucher_id),
        allow_partial: allowPartial,
      },
      {
        onSuccess: () => resetForm(),
        onError: (e: Error) => {
          if (e.message.toLowerCase().includes("exact float")) setShowPartial(true);
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Petty Cash Replenishments</h1>
          <p className="page-description">
            Reimburse approved vouchers as a batch to restore the fund to its fixed float.
          </p>
        </div>
      </div>

      {/* Imprest builder */}
      {canEdit("banking") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="w-4 h-4" /> New Imprest Replenishment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Petty Cash Fund</Label>
                <Select value={pcAccountId} onValueChange={setPcAccountId}>
                  <SelectTrigger><SelectValue placeholder="Select fund" /></SelectTrigger>
                  <SelectContent>
                    {pcAccounts?.filter((a) => a.is_active).map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Bank Account</Label>
                <AccountCombobox
                  options={bankAccounts ?? []}
                  value={bankAccountId}
                  onChange={setBankAccountId}
                  placeholder="Select bank"
                />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>

            {pcAccountId && (
              <>
                {/* Voucher batch */}
                {!vouchers?.length ? (
                  <div className="py-4 text-center border rounded-md space-y-2">
                    <p className="text-sm text-muted-foreground">
                      No approved, unreimbursed vouchers for this fund. Approve some vouchers first
                      {currentBalance <= 0 && " — or put the opening float in below"}.
                    </p>
                    {currentBalance <= 0 && <PCFundDialog defaultPcAccountId={pcAccountId} />}
                  </div>
                ) : (
                  <div className="border rounded-md overflow-hidden">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th className="w-10">
                            <input
                              type="checkbox"
                              checked={allChecked}
                              onChange={(e) =>
                                setChecked(
                                  Object.fromEntries(vouchers.map((v) => [v.voucher_id, e.target.checked])),
                                )
                              }
                            />
                          </th>
                          <th>Voucher #</th>
                          <th>Date</th>
                          <th>Paid To</th>
                          <th className="text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vouchers.map((v) => (
                          <tr key={v.voucher_id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={!!checked[v.voucher_id]}
                                onChange={(e) =>
                                  setChecked((c) => ({ ...c, [v.voucher_id]: e.target.checked }))
                                }
                              />
                            </td>
                            <td className="font-mono text-xs">{v.voucher_number}</td>
                            <td className="text-muted-foreground">{formatDate(v.voucher_date)}</td>
                            <td>{v.paid_to || "—"}</td>
                            <td className="text-right font-medium">{formatCurrency(Number(v.total_amount))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Summary */}
                <div className="grid gap-3 md:grid-cols-4">
                  <SummaryStat label="Current Balance" value={formatCurrency(currentBalance)} />
                  <SummaryStat label="Defined Float" value={formatCurrency(float)} />
                  <SummaryStat label="Top-up Amount" value={formatCurrency(topup)} />
                  <div className="stat-card p-3">
                    <p className="text-xs text-muted-foreground">Balance After</p>
                    <p className={`text-lg font-semibold ${restoresToFloat ? "text-success" : "text-warning"}`}>
                      {formatCurrency(balanceAfter)}
                    </p>
                    {topup > 0 && (
                      restoresToFloat ? (
                        <span className="text-xs text-success">Restores to float ✓</span>
                      ) : (
                        <span className="text-xs text-warning">Won't match float</span>
                      )
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {showPartial && (
                    <Button
                      variant="outline"
                      onClick={() => doPost(true)}
                      disabled={postImprest.isPending}
                    >
                      Top up by voucher total anyway
                    </Button>
                  )}
                  <Button
                    onClick={() => doPost(false)}
                    disabled={!bankAccountId || !checkedVouchers.length || postImprest.isPending}
                  >
                    <CheckCircle className="w-4 h-4 mr-1" />
                    {postImprest.isPending ? "Posting…" : "Post Replenishment"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* History */}
      <Card>
        <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
        <CardContent>
          {!replenishments?.length ? (
            <p className="text-center py-8 text-muted-foreground">No replenishments yet</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>PC Account</th>
                  <th>Bank Account</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Vouchers Reimbursed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {replenishments.map((r: any) => (
                  <tr key={r.id}>
                    <td className="font-mono text-sm">{r.replenishment_number}</td>
                    <td className="text-muted-foreground">{formatDate(r.date)}</td>
                    <td>{r.petty_cash_accounts?.account_name}</td>
                    <td className="text-muted-foreground">{r.bank_account?.account_code} – {r.bank_account?.account_name}</td>
                    <td className="text-right font-medium">{formatCurrency(r.amount)}</td>
                    <td className="text-right">{r.reimbursed?.[0]?.count ?? 0}</td>
                    <td>
                      <Badge variant={r.status === "approved" ? "default" : "secondary"}>{r.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
