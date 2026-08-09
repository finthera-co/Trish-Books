import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, AlertTriangle, CheckCircle2, Hash, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSerialRegister } from "@/hooks/useSerialRegister";
import { useInvoiceNextNumbers, useSetInvoiceNextNumber, useDeleteInvoiceNumberSeries, type NextNumberRow } from "@/hooks/useInvoiceNumbering";
import { useLegacyInvoiceNumbering } from "@/hooks/useTenantFeature";
import { useCompanyProfile, useUpdateCompanyProfile } from "@/hooks/useCompanyProfile";

const today = () => new Date().toISOString().slice(0, 10);
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const periodLabel = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? "—" : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

/**
 * Set where the automatic numbering carries on from — the control a business
 * migrating from another system needs: point it past the invoices they already
 * raised, key those in by hand with their original numbers, and the sequence
 * continues cleanly from there.
 *
 * Numbering restarts each month per branch under the IRD format, so the counter
 * belongs to one branch + month rather than the whole company.
 */
function NextNumberCard() {
  const [period, setPeriod] = useState(today());
  const [branch, setBranch] = useState("");
  const [nextSeq, setNextSeq] = useState("");
  const { data: current } = useInvoiceNextNumbers(period);
  const setNext = useSetInvoiceNextNumber();
  const deleteSeries = useDeleteInvoiceNumberSeries();
  const [deleteTarget, setDeleteTarget] = useState<NextNumberRow | null>(null);
  // The branch code differs per business, so it's a saved tenant default rather
  // than something to re-type: it pre-fills here and on every new invoice.
  const { data: profile } = useCompanyProfile();
  const updateProfile = useUpdateCompanyProfile();
  const savedBranch = profile?.default_branch_code ?? "";
  const [branchTouched, setBranchTouched] = useState(false);
  useEffect(() => {
    if (!branchTouched) setBranch(savedBranch);
  }, [savedBranch, branchTouched]);

  const apply = () => {
    const n = Number(nextSeq);
    if (!Number.isInteger(n) || n < 1) return;
    const code = branch.trim() || "MAIN";
    setNext.mutate(
      { branchCode: code, period, nextSeq: n },
      {
        onSuccess: () => {
          setNextSeq("");
          // Remember the code that was actually used, so the next invoice and
          // the next visit here both start from it.
          if (code !== savedBranch) {
            updateProfile.mutate({ default_branch_code: code });
            setBranchTouched(false);
          }
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Hash className="w-4 h-4 text-primary" /> Next invoice number
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Where automatic numbering carries on from. Moving to Trish Books mid-year? Set this past your
          existing invoices, then enter the old ones with their original numbers typed into the
          invoice number field.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Month</Label>
            <Input type="date" className="h-9" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Branch (QQQQ)</Label>
            <Input className="h-9 font-mono" value={branch} maxLength={15}
              onChange={(e) => { setBranchTouched(true); setBranch(e.target.value.replace(/\s/g, "")); }}
              placeholder="MAIN" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Next number</Label>
            <Input type="number" className="h-9 font-mono" value={nextSeq} min={1} step={1}
              onChange={(e) => setNextSeq(e.target.value)} placeholder="e.g. 61" />
          </div>
          <div className="flex items-end">
            <Button className="h-9 w-full" onClick={apply} disabled={!nextSeq || setNext.isPending}>
              {setNext.isPending ? "Setting…" : "Set"}
            </Button>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Numbering restarts every month, so this applies to {periodLabel(period)} for the branch shown.
          It can only move forward — a number already issued is never handed out twice.
          {" "}The branch code is saved as this company's default and pre-fills new invoices.
        </p>

        {(current ?? []).length > 0 && (
          <div className="rounded-lg border border-border divide-y divide-border">
            {(current ?? []).map((r) => (
              <div key={`${r.branch_code}-${r.yy}-${r.mmm}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  Branch <span className="font-mono text-foreground">{r.branch_code}</span> · {r.mmm} 20{String(r.yy).padStart(2, "0")}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono tabular-nums text-foreground">
                    next: <span className="font-semibold">{r.next_serial}</span>
                  </span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title={`Remove the ${r.branch_code} series`}
                    onClick={() => setDeleteTarget(r)} disabled={deleteSeries.isPending}>
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Removing a series is only possible while it has issued nothing — the
            RPC re-checks and refuses otherwise. */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove the {deleteTarget?.branch_code} number series?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes the counter and every register row for branch {deleteTarget?.branch_code} in{" "}
                {deleteTarget?.mmm} 20{String(deleteTarget?.yy ?? "").padStart(2, "0")}. It is refused if any
                invoice still uses a number from this series.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (!deleteTarget) return;
                  deleteSeries.mutate({ branchCode: deleteTarget.branch_code, period });
                  setDeleteTarget(null);
                }}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

const statusBadge = (s: string) =>
  s === "issued" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
  : s === "cancelled" ? "bg-destructive/10 text-destructive"
  // Skipped is deliberate, not a problem — keep it neutral rather than alarming.
  : s === "skipped" ? "bg-muted text-muted-foreground"
  : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";

export default function InvoiceSerialRegister() {
  const navigate = useNavigate();
  const { data: groups, isLoading } = useSerialRegister();
  const canSetNextNumber = useLegacyInvoiceNumbering();

  const totalMissing = (groups ?? []).reduce((s, g) => s + g.missing.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-primary" /> Invoice Number Register</h1>
          <p className="text-sm text-muted-foreground">Every system-generated IRD serial, accounted for — issued, reserved, or cancelled</p>
        </div>
      </div>

      {/* Compliance banner */}
      <div className={`rounded-lg border px-4 py-3 flex items-center gap-2 text-sm ${totalMissing === 0
        ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
        : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
        {totalMissing === 0
          ? <><CheckCircle2 className="w-4 h-4" /> Every issued number is accounted for — no unexplained gaps in the sequence.</>
          : <><AlertTriangle className="w-4 h-4" /> {totalMissing} number(s) are missing from the sequence and need investigation.</>}
      </div>

      {/* Only for tenants migrating from another system — see
          useLegacyInvoiceNumbering. The RPC behind it is gated too. */}
      {canSetNextNumber && <NextNumberCard />}

      {isLoading ? (
        <p className="text-center py-8 text-muted-foreground">Loading…</p>
      ) : (groups ?? []).length === 0 ? (
        <p className="text-center py-8 text-muted-foreground">No invoice numbers issued yet</p>
      ) : (
        (groups ?? []).map((g) => (
          <Card key={g.key}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Branch {g.branch_code} · {g.mmm} 20{String(g.yy).padStart(2, "0")}</CardTitle>
                <div className="flex items-center gap-2 text-xs">
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">{g.issued} issued</Badge>
                  {g.reserved > 0 && <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">{g.reserved} reserved</Badge>}
                  {g.cancelled > 0 && <Badge className="bg-destructive/10 text-destructive">{g.cancelled} cancelled</Badge>}
                  {g.skipped > 0 && <Badge className="bg-muted text-muted-foreground">{g.skipped} skipped</Badge>}
                  {g.missing.length > 0 && <Badge className="bg-destructive/10 text-destructive">gap: {g.missing.join(", ")}</Badge>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-16">Seq</TableHead><TableHead>Serial</TableHead>
                  <TableHead>Status</TableHead><TableHead>Reason</TableHead><TableHead>Recorded</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {g.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground tabular-nums">{r.seq}</TableCell>
                      <TableCell className="font-mono font-medium">{r.serial}</TableCell>
                      <TableCell><Badge className={statusBadge(r.status)}>{r.status}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{r.reason || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
