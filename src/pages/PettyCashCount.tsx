import { useState, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Calculator, CheckCircle2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePettyCashAccounts, usePCBalance } from "@/hooks/usePettyCash";
import { useCreatePCCount, usePostPCCount, usePCCount } from "@/hooks/usePettyCashCount";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";

// Default Sri Lanka denominations (face value + note/coin classification).
const DEFAULT_DENOMINATIONS: { value: number; type: "note" | "coin" }[] = [
  { value: 5000, type: "note" },
  { value: 1000, type: "note" },
  { value: 500, type: "note" },
  { value: 100, type: "note" },
  { value: 50, type: "note" },
  { value: 20, type: "note" },
  { value: 10, type: "coin" },
  { value: 5, type: "coin" },
  { value: 2, type: "coin" },
  { value: 1, type: "coin" },
  { value: 0.5, type: "coin" },
];

function VarianceBadge({ variance }: { variance: number }) {
  if (variance === 0) {
    return <Badge className="bg-success/15 text-success hover:bg-success/15">Balanced</Badge>;
  }
  const label = variance > 0 ? "Overage" : "Shortage";
  return (
    <Badge className="bg-warning/15 text-warning hover:bg-warning/15">
      {label} {formatCurrency(Math.abs(variance))}
    </Badge>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Read-only view for an existing (draft or posted) count
// ───────────────────────────────────────────────────────────────────────────
function ExistingCountView({ id }: { id: string }) {
  const navigate = useNavigate();
  const { data: count, isLoading } = usePCCount(id);
  const postCount = usePostPCCount();

  if (isLoading) return <p className="text-center py-8 text-muted-foreground">Loading count…</p>;
  if (!count) return <p className="text-center py-8 text-muted-foreground">Count not found.</p>;

  const variance = Number(count.variance || 0);
  const isDraft = count.status === "draft";

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/banking/petty-cash/counts")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="page-title flex items-center gap-2">
              {count.count_number}
              <Badge variant="outline">{count.status}</Badge>
            </h1>
            <p className="page-description">
              {(count.petty_cash_accounts as any)?.account_name} · {formatDate(count.count_date)}
            </p>
          </div>
        </div>
        {isDraft && (
          <Button onClick={() => postCount.mutate(id)} disabled={postCount.isPending}>
            <CheckCircle2 className="w-4 h-4 mr-2" />
            {postCount.isPending ? "Posting…" : "Post Count"}
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Book Balance</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{formatCurrency(Number(count.book_balance || 0))}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Counted</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{formatCurrency(Number(count.counted_balance || 0))}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Variance</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <p className={`text-2xl font-semibold ${variance === 0 ? "text-success" : "text-warning"}`}>
              {formatCurrency(variance)}
            </p>
            <VarianceBadge variance={variance} />
          </CardContent>
        </Card>
      </div>

      {count.journal_entry_id && (
        <Button
          variant="outline"
          onClick={() => navigate(`/accounting/journal-entries/${count.journal_entry_id}`)}
        >
          <FileText className="w-4 h-4 mr-2" /> View variance journal entry
        </Button>
      )}

      <div className="stat-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Denomination</th>
              <th>Type</th>
              <th className="text-right">Quantity</th>
              <th className="text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {(count.denominations as any[]).map((d) => (
              <tr key={d.id}>
                <td>{formatCurrency(Number(d.denomination))}</td>
                <td><Badge variant="outline">{d.denom_type}</Badge></td>
                <td className="text-right">{d.quantity}</td>
                <td className="text-right font-medium">{formatCurrency(Number(d.subtotal))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {count.notes && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Notes</CardTitle></CardHeader>
          <CardContent><p className="text-sm whitespace-pre-wrap">{count.notes}</p></CardContent>
        </Card>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// New count entry
// ───────────────────────────────────────────────────────────────────────────
function NewCountForm({ initialAccount }: { initialAccount: string }) {
  const navigate = useNavigate();
  const { appUser } = useAuth();
  const { data: accounts } = usePettyCashAccounts();
  const createCount = useCreatePCCount();

  const [accountId, setAccountId] = useState(initialAccount);
  const [countDate, setCountDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [confirmZero, setConfirmZero] = useState(false);
  const [quantities, setQuantities] = useState<Record<number, number>>({});

  const { data: balance } = usePCBalance(accountId || undefined);
  const bookBalance = Number(balance?.remaining || 0);

  const rows = useMemo(
    () =>
      DEFAULT_DENOMINATIONS.map((d, i) => {
        const qty = quantities[i] || 0;
        return { ...d, index: i, qty, subtotal: Number((d.value * qty).toFixed(2)) };
      }),
    [quantities],
  );

  const countedTotal = useMemo(() => rows.reduce((s, r) => s + r.subtotal, 0), [rows]);
  const variance = Number((countedTotal - bookBalance).toFixed(2));
  const hasAnyQty = rows.some((r) => r.qty > 0);
  const counterName = appUser ? `${appUser.first_name} ${appUser.last_name}` : "";

  const canSave = !!accountId && (hasAnyQty || confirmZero);

  const handleSave = () => {
    createCount.mutate(
      {
        petty_cash_account_id: accountId,
        count_date: countDate,
        book_balance: bookBalance,
        counted_balance: countedTotal,
        notes: notes || undefined,
        denominations: rows
          .filter((r) => r.qty > 0)
          .map((r) => ({
            denomination: r.value,
            denom_type: r.type,
            quantity: r.qty,
            subtotal: r.subtotal,
            sort_order: r.index,
          })),
      },
      { onSuccess: (count) => navigate(`/banking/petty-cash/counts/${count.id}`) },
    );
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/banking/petty-cash/counts")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="page-title flex items-center gap-2"><Calculator className="w-5 h-5" /> Physical Cash Count</h1>
            <p className="page-description">Count the physical cash and reconcile it against the ledger book balance.</p>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 md:grid-cols-3 pt-6">
          <div className="space-y-2">
            <Label>Petty Cash Fund</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Select fund" /></SelectTrigger>
              <SelectContent>
                {(accounts || []).map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Count Date</Label>
            <Input type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Counted By</Label>
            <Input value={counterName} disabled />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Book Balance</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{formatCurrency(bookBalance)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Counted Total</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{formatCurrency(countedTotal)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Variance</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <p className={`text-2xl font-semibold ${variance === 0 ? "text-success" : "text-warning"}`}>
              {formatCurrency(variance)}
            </p>
            <VarianceBadge variance={variance} />
          </CardContent>
        </Card>
      </div>

      <div className="stat-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Denomination</th>
              <th>Type</th>
              <th className="w-40 text-right">Quantity</th>
              <th className="text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.index}>
                <td className="font-medium">{formatCurrency(r.value)}</td>
                <td><Badge variant="outline">{r.type}</Badge></td>
                <td className="text-right">
                  <Input
                    type="number"
                    min={0}
                    className="text-right ml-auto max-w-28"
                    value={quantities[r.index] ?? ""}
                    onChange={(e) =>
                      setQuantities((q) => ({ ...q, [r.index]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))
                    }
                  />
                </td>
                <td className="text-right font-medium">{r.subtotal > 0 ? formatCurrency(r.subtotal) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              placeholder="Optional notes about this count (e.g. reason for variance)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {!hasAnyQty && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={confirmZero} onChange={(e) => setConfirmZero(e.target.checked)} />
              Confirm this is a true zero count (no cash on hand)
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => navigate("/banking/petty-cash/counts")}>Cancel</Button>
            <Button onClick={handleSave} disabled={!canSave || createCount.isPending}>
              {createCount.isPending ? "Saving…" : "Save Draft"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Save the draft, then use <strong>Post Count</strong> to record any variance to Cash Over/Short.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PettyCashCount() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  if (id) return <ExistingCountView id={id} />;
  return <NewCountForm initialAccount={searchParams.get("account") || ""} />;
}
