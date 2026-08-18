import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import AccountSelector from "@/components/shared/AccountSelector";
import { ChevronDown, ChevronRight, Printer, Info } from "lucide-react";
import {
  useTaxPeriods, useTaxTransactions, useTaxLiabilities, useTaxReturns,
  useCloseTaxPeriod, useFileTaxReturn, usePostTaxRemittance,
  type TaxPeriodRow, type TaxTransactionRow,
} from "@/hooks/useTaxEngine";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";

const fmt = (n: number) =>
  n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function periodLabel(p: TaxPeriodRow) {
  return `${formatDate(p.period_start)} → ${formatDate(p.period_end)}`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "open" ? "default" : status === "closed" ? "secondary" : "outline"}>
      {status}
    </Badge>
  );
}

/* ── Drill-down table of contributing tax_transactions ── */
function DrillDown({ rows }: { rows: TaxTransactionRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground py-2">No transactions.</p>;
  return (
    <table className="data-table w-full text-xs">
      <thead>
        <tr><th>Date</th><th>Code</th><th>Source</th><th>Direction</th><th className="text-right">Base</th><th className="text-right">Tax</th><th>Journal</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{formatDate(r.transaction_date)}</td>
            <td className="font-mono">{r.tax_codes?.code}</td>
            <td>
              <Link className="underline" to={
                r.source_type === "invoice" || (r.source_type === "reversal" && r.direction === "output")
                  ? `/sales/invoices` : r.source_type === "supplier_bill" ? `/accounting/bills`
                  : r.source_type === "payroll_run" ? `/payroll/runs` : `/accounting/journals`
              }>
                {r.source_type}{r.is_reversed ? " (reversed)" : ""}
              </Link>
            </td>
            <td>{r.direction}</td>
            <td className="text-right">{fmt(Number(r.base_amount))}</td>
            <td className="text-right">{fmt(Number(r.tax_amount))}</td>
            <td>
              {r.journal_entry_id
                ? <Link className="underline" to={`/accounting/journals/${r.journal_entry_id}`}>view</Link>
                : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReturnRow({ label, amount, rows }: { label: string; amount: number; rows: TaxTransactionRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b last:border-b-0">
      <button className="w-full flex items-center justify-between py-2 text-sm hover:bg-muted/40 px-2"
        onClick={() => setOpen(!open)}>
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {label}
        </span>
        <span className="font-mono">{fmt(amount)}</span>
      </button>
      {open && <div className="px-2 pb-2"><DrillDown rows={rows} /></div>}
    </div>
  );
}

/* ── Period header: selector + close/file actions ── */
function PeriodHeader({
  taxType, period, setPeriodId, returnType, summary, totalPayable, totalCredit,
}: {
  taxType: string;
  period: TaxPeriodRow | undefined;
  setPeriodId: (id: string) => void;
  returnType: string;
  summary: Record<string, unknown>;
  totalPayable: number;
  totalCredit: number;
}) {
  const { data: periods } = useTaxPeriods(taxType);
  const closePeriod = useCloseTaxPeriod();
  const fileReturn = useFileTaxReturn();
  const [fileOpen, setFileOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [irdRef, setIrdRef] = useState("");

  if (!periods?.length) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          No tax periods — configure your <Link to="/settings/tax" className="underline">Tax Profile</Link> first.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Select value={period?.id} onValueChange={setPeriodId}>
        <SelectTrigger className="w-64"><SelectValue placeholder="Select period" /></SelectTrigger>
        <SelectContent>
          {periods.map((p) => <SelectItem key={p.id} value={p.id}>{periodLabel(p)}</SelectItem>)}
        </SelectContent>
      </Select>
      {period && <StatusBadge status={period.status} />}
      <div className="flex-1" />
      {period && period.status === "open" && (
        <Button variant="outline" size="sm" onClick={() => setCloseOpen(true)}>Close Period</Button>
      )}
      {period && period.status !== "filed" && (
        <Button size="sm" onClick={() => setFileOpen(true)}>Mark as Filed</Button>
      )}

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close period?</DialogTitle>
            <DialogDescription>
              Closing {period && periodLabel(period)} marks it review-complete. It can be reopened until filed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>Cancel</Button>
            <Button onClick={() => { closePeriod.mutate({ periodId: period!.id }); setCloseOpen(false); }}>Close Period</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fileOpen} onOpenChange={setFileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {returnType.replace(/_/g, " ")} as filed</DialogTitle>
            <DialogDescription>
              Snapshots the return figures and freezes the period — new tax entries dated inside it will be blocked
              (amendments flow into the current open period).
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>IRD reference</Label>
            <Input value={irdRef} onChange={(e) => setIrdRef(e.target.value)} placeholder="e.g. ACK-2026-001234" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFileOpen(false)}>Cancel</Button>
            <Button disabled={!irdRef || fileReturn.isPending}
              onClick={() => fileReturn.mutate(
                { periodId: period!.id, returnType, summary, totalPayable, totalCredit, irdReference: irdRef },
                { onSuccess: () => setFileOpen(false) }
              )}>
              {fileReturn.isPending ? "Filing..." : "Mark as Filed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═══════════════════ VAT Return tab ═══════════════════ */

function VatReturnTab() {
  const { data: periods } = useTaxPeriods("VAT");
  const [periodId, setPeriodId] = useState<string | null>(null);
  const period = (periods || []).find((p) => p.id === periodId) ?? (periods || [])[0];
  const { data: txns, isLoading } = useTaxTransactions({ periodId: period?.id, taxType: "VAT" });
  const { data: returns } = useTaxReturns(period?.id);
  const filedReturn = (returns || []).find((r) => r.status === "filed");

  // Signed amounts → reversal rows net automatically
  const sections = useMemo(() => {
    const rows = txns || [];
    const by = (pred: (r: TaxTransactionRow) => boolean) => rows.filter(pred);
    const sum = (rs: TaxTransactionRow[], f: (r: TaxTransactionRow) => number) =>
      Math.round(rs.reduce((s, r) => s + f(r), 0) * 100) / 100;

    const stdOutput = by((r) => r.direction === "output" && Number(r.rate_applied) > 0 && r.source_type !== "tax_remittance");
    const zeroRated = by((r) => r.direction === "output" && Number(r.rate_applied) === 0 && r.tax_codes?.code !== "VAT-EX" && r.source_type !== "tax_remittance");
    const exempt = by((r) => r.direction === "output" && r.tax_codes?.code === "VAT-EX");
    const rcOutput = by((r) => r.direction === "reverse_charge_output");
    const input = by((r) => r.direction === "input");
    const rcInput = by((r) => r.direction === "reverse_charge_input");

    const outputTax = sum(stdOutput, (r) => Number(r.tax_amount));
    const rcOutputTax = sum(rcOutput, (r) => Number(r.tax_amount));
    const inputTax = sum(input, (r) => Number(r.tax_amount)) + sum(rcInput, (r) => Number(r.tax_amount));
    const net = Math.round((outputTax + rcOutputTax - inputTax) * 100) / 100;

    return {
      stdOutput, zeroRated, exempt, rcOutput, input, rcInput,
      outputTax, rcOutputTax, inputTax, net,
      zeroValue: sum(zeroRated, (r) => Number(r.base_amount)),
      exemptValue: sum(exempt, (r) => Number(r.base_amount)),
      stdValue: sum(stdOutput, (r) => Number(r.base_amount)),
    };
  }, [txns]);

  const summary = {
    standard_rated_supplies: sections.stdValue,
    output_tax: sections.outputTax,
    zero_rated_supplies: sections.zeroValue,
    exempt_supplies: sections.exemptValue,
    reverse_charge_output: sections.rcOutputTax,
    input_tax_claimed: sections.inputTax,
    net_payable: sections.net,
  };

  return (
    <div className="space-y-4">
      <PeriodHeader taxType="VAT" period={period} setPeriodId={setPeriodId}
        returnType="VAT_RETURN" summary={summary}
        totalPayable={Math.max(0, sections.net)} totalCredit={Math.max(0, -sections.net)} />
      {period?.status === "filed" && filedReturn && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Filed {filedReturn.filed_at?.slice(0, 10)} — ref #{filedReturn.ird_reference}. Showing the filed snapshot, not live data.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>VAT Return</CardTitle>
          <CardDescription>All figures in LKR, from the tax sub-ledger. Signed reversals net automatically.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-8 bg-muted animate-pulse rounded" />)}</div>
          ) : period?.status === "filed" && filedReturn ? (
            <div className="divide-y">
              {Object.entries(filedReturn.summary_json || {}).map(([k, v]) => (
                <div key={k} className="flex justify-between py-2 text-sm px-2">
                  <span>{k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                  <span className="font-mono">{fmt(Number(v))}</span>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <ReturnRow label="Value of standard-rated supplies" amount={sections.stdValue} rows={sections.stdOutput} />
              <ReturnRow label="Output tax on standard-rated supplies" amount={sections.outputTax} rows={sections.stdOutput} />
              <ReturnRow label="Value of zero-rated supplies" amount={sections.zeroValue} rows={sections.zeroRated} />
              <ReturnRow label="Value of exempt supplies" amount={sections.exemptValue} rows={sections.exempt} />
              <ReturnRow label="Reverse-charge output tax" amount={sections.rcOutputTax} rows={sections.rcOutput} />
              <ReturnRow label="Input tax claimed (incl. reverse charge)" amount={sections.inputTax} rows={[...sections.input, ...sections.rcInput]} />
              <div className="flex justify-between py-3 px-2 font-semibold">
                <span>Net VAT {sections.net >= 0 ? "payable" : "(credit)"}</span>
                <span className="font-mono">{fmt(Math.abs(sections.net))}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ═══════════════════ SSCL tab ═══════════════════ */

function SsclTab() {
  const { data: periods } = useTaxPeriods("SSCL");
  const [periodId, setPeriodId] = useState<string | null>(null);
  const period = (periods || []).find((p) => p.id === periodId) ?? (periods || [])[0];
  const { data: txns, isLoading } = useTaxTransactions({ periodId: period?.id, taxType: "SSCL" });

  const liable = (txns || []).filter((r) => r.source_type !== "tax_remittance");
  const turnover = Math.round(liable.reduce((s, r) => s + Number(r.base_amount), 0) * 100) / 100;
  const sscl = Math.round(liable.reduce((s, r) => s + Number(r.tax_amount), 0) * 100) / 100;

  return (
    <div className="space-y-4">
      <PeriodHeader taxType="SSCL" period={period} setPeriodId={setPeriodId}
        returnType="SSCL_RETURN"
        summary={{ liable_turnover: turnover, sscl_payable: sscl }}
        totalPayable={Math.max(0, sscl)} totalCredit={Math.max(0, -sscl)} />
      <Card>
        <CardHeader><CardTitle>SSCL Summary</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <div className="h-8 bg-muted animate-pulse rounded" /> : (
            <div>
              <ReturnRow label="Liable turnover" amount={turnover} rows={liable} />
              <ReturnRow label="SSCL payable" amount={sscl} rows={liable} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ═══════════════════ WHT tab ═══════════════════ */

function WhtCertificate({ row, onClose }: { row: any; onClose: () => void }) {
  const { appUser } = useAuth();
  const { data: meta } = useQuery({
    queryKey: ["wht_cert_meta", row?.id],
    enabled: !!row,
    queryFn: async () => {
      const sb = supabase as any;
      const [{ data: tenant }, { data: profile }, { data: vendor }] = await Promise.all([
        sb.from("tenants").select("name").eq("id", appUser!.tenant_id).single(),
        sb.from("tenant_tax_profiles").select("tin").eq("tenant_id", appUser!.tenant_id).maybeSingle(),
        row.vendor_id ? sb.from("vendors").select("name, tin").eq("id", row.vendor_id).single() : Promise.resolve({ data: null }),
      ]);
      return { tenant, profile, vendor };
    },
  });

  if (!row) return null;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl print:shadow-none">
        <div className="space-y-4 p-2" id="wht-certificate">
          <div className="text-center border-b pb-3">
            <h2 className="text-lg font-semibold">{meta?.tenant?.name ?? ""}</h2>
            <p className="text-sm text-muted-foreground">Withholding Tax Certificate</p>
            <p className="text-xs text-muted-foreground">Issued under the Inland Revenue Act (AIT)</p>
          </div>
          <table className="w-full text-sm">
            <tbody>
              <tr><td className="py-1 text-muted-foreground">Certificate No</td><td className="text-right font-mono">{row.wht_certificate_no}</td></tr>
              <tr><td className="py-1 text-muted-foreground">Deducting agent TIN</td><td className="text-right">{meta?.profile?.tin ?? "—"}</td></tr>
              <tr><td className="py-1 text-muted-foreground">Payee</td><td className="text-right">{meta?.vendor?.name ?? "—"}</td></tr>
              <tr><td className="py-1 text-muted-foreground">Payee TIN</td><td className="text-right">{meta?.vendor?.tin ?? "—"}</td></tr>
              <tr><td className="py-1 text-muted-foreground">Nature of payment</td><td className="text-right">{row.payment_nature ?? "—"}</td></tr>
              <tr><td className="py-1 text-muted-foreground">Payment date</td><td className="text-right">{formatDate(row.payment_date)}</td></tr>
              <tr><td className="py-1 text-muted-foreground">Gross amount</td><td className="text-right font-mono">{fmt(Number(row.amount))}</td></tr>
              <tr><td className="py-1 text-muted-foreground">WHT rate</td><td className="text-right">{row.rate_label}</td></tr>
              <tr className="font-semibold border-t"><td className="py-2">Tax withheld</td><td className="text-right font-mono">{fmt(Number(row.wht_amount))}</td></tr>
            </tbody>
          </table>
        </div>
        <DialogFooter className="print:hidden">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => window.print()}><Printer className="w-4 h-4" />Print</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WhtTab() {
  const { appUser } = useAuth();
  const [certRow, setCertRow] = useState<any>(null);

  const { data: byUs, isLoading } = useQuery({
    queryKey: ["wht_by_us", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb
        .from("bill_payments")
        .select("id, vendor_id, payment_date, amount, wht_amount, wht_certificate_no, payment_nature, wht_rule_id, vendors(name), wht_rules(rate)")
        .eq("tenant_id", appUser!.tenant_id)
        .gt("wht_amount", 0)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: fromUs } = useTaxTransactions({ direction: "wht_receivable" });

  return (
    <div className="space-y-4">
      <Tabs defaultValue="by-us">
        <TabsList>
          <TabsTrigger value="by-us">Withheld by us</TabsTrigger>
          <TabsTrigger value="from-us">Withheld from us</TabsTrigger>
        </TabsList>
        <TabsContent value="by-us" className="mt-3">
          <Card>
            <CardHeader>
              <CardTitle>WHT withheld from vendors</CardTitle>
              <CardDescription>Settlement-based AIT — one certificate per payment.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? <div className="h-8 bg-muted animate-pulse rounded" /> :
                (byUs || []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No WHT withheld yet — it is computed automatically when paying bills.</p>
              ) : (
                <table className="data-table w-full">
                  <thead><tr><th>Vendor</th><th>Month</th><th className="text-right">Gross</th><th className="text-right">WHT</th><th>Certificate</th><th /></tr></thead>
                  <tbody>
                    {(byUs || []).map((r) => (
                      <tr key={r.id}>
                        <td>{r.vendors?.name}</td>
                        <td>{r.payment_date?.slice(0, 7)}</td>
                        <td className="text-right">{fmt(Number(r.amount))}</td>
                        <td className="text-right">{fmt(Number(r.wht_amount))}</td>
                        <td className="font-mono">{r.wht_certificate_no ?? "—"}</td>
                        <td className="text-right">
                          <Button size="icon" variant="ghost"
                            onClick={() => setCertRow({ ...r, rate_label: r.wht_rules?.rate ? `${Number(r.wht_rules.rate)}%` : "—" })}>
                            <Printer className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="from-us" className="mt-3">
          <Card>
            <CardHeader>
              <CardTitle>WHT withheld from us by customers</CardTitle>
              <CardDescription>Credit against income tax — from the tax sub-ledger.</CardDescription>
            </CardHeader>
            <CardContent><DrillDown rows={fromUs || []} /></CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {certRow && <WhtCertificate row={certRow} onClose={() => setCertRow(null)} />}
    </div>
  );
}

/* ═══════════════════ APIT tab ═══════════════════ */

function ApitTab() {
  const { appUser } = useAuth();
  const { data: txns, isLoading } = useTaxTransactions({ taxType: "APIT", direction: "wht_payable" });

  const employeeIds = useMemo(
    () => [...new Set((txns || []).map((t) => t.source_line_id).filter(Boolean))] as string[],
    [txns]
  );
  const { data: employees } = useQuery({
    queryKey: ["apit_employees", appUser?.tenant_id, employeeIds],
    enabled: employeeIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("employees").select("id, first_name, last_name").in("id", employeeIds);
      return new Map(((data as any[]) || []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
    },
  });

  const total = (txns || []).reduce((s, r) => s + Number(r.tax_amount), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>APIT (PAYE) remittance summary</CardTitle>
        <CardDescription>Per employee per month, from posted payroll runs.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <div className="h-8 bg-muted animate-pulse rounded" /> :
          (txns || []).length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No APIT yet — mark employees PAYE-applicable and post a payroll run.
          </p>
        ) : (
          <table className="data-table w-full">
            <thead><tr><th>Employee</th><th>Month</th><th className="text-right">Gross</th><th className="text-right">APIT</th><th>Journal</th></tr></thead>
            <tbody>
              {(txns || []).map((r) => (
                <tr key={r.id}>
                  <td>{(employees as any)?.get(r.source_line_id) ?? r.source_line_id}</td>
                  <td>{r.transaction_date.slice(0, 7)}</td>
                  <td className="text-right">{fmt(Number(r.base_amount))}</td>
                  <td className="text-right">{fmt(Number(r.tax_amount))}</td>
                  <td>{r.journal_entry_id ? <Link className="underline" to={`/accounting/journals/${r.journal_entry_id}`}>view</Link> : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold border-t">
                <td colSpan={3} className="py-2">Monthly total</td>
                <td className="text-right font-mono">{fmt(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/* ═══════════════════ Liabilities tab ═══════════════════ */

function RemittanceDialog({ liability, onClose }: { liability: any; onClose: () => void }) {
  const post = usePostTaxRemittance();
  const [amount, setAmount] = useState(String(liability.outstanding));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [bank, setBank] = useState<string | null>(null);
  const [ref, setRef] = useState("");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remit {liability.code} to IRD</DialogTitle>
          <DialogDescription>Dr {liability.name} liability / Cr bank — posts a journal and the sub-ledger row.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Amount (LKR)</Label>
            <Input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Bank account</Label>
            <AccountSelector value={bank} types={["Asset"]} onChange={(v) => setBank(v)} />
          </div>
          <div className="col-span-2">
            <Label>IRD payment reference</Label>
            <Input value={ref} onChange={(e) => setRef(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!bank || Number(amount) <= 0 || post.isPending}
            onClick={() => post.mutate(
              { tax_code_id: liability.tax_code_id, amount: Number(amount), remittance_date: date, bank_account_id: bank!, reference: ref },
              { onSuccess: () => onClose() }
            )}>
            {post.isPending ? "Posting..." : "Remit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LiabilitiesTab() {
  const { data: liabilities, isLoading } = useTaxLiabilities();
  const [remitFor, setRemitFor] = useState<any>(null);

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-32 bg-muted animate-pulse rounded" />)}
        </div>
      ) : (liabilities || []).length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          No tax activity yet — liabilities appear once tax is posted on documents.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(liabilities || []).map((l) => (
            <div key={l.tax_code_id} className="stat-card space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-mono text-sm font-medium">{l.code}</p>
                <Badge variant="secondary">{l.tax_type}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{l.name}</p>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Accrued</span><span className="font-mono">{fmt(l.accrued)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Remitted</span><span className="font-mono">{fmt(l.remitted)}</span></div>
                <div className="flex justify-between font-semibold"><span>Outstanding</span><span className="font-mono">{fmt(l.outstanding)}</span></div>
              </div>
              <Button size="sm" className="w-full" disabled={l.outstanding <= 0}
                onClick={() => setRemitFor(l)}>Remit</Button>
            </div>
          ))}
        </div>
      )}
      {remitFor && <RemittanceDialog liability={remitFor} onClose={() => setRemitFor(null)} />}
    </div>
  );
}

/* ═══════════════════ Page ═══════════════════ */

export default function TaxCenter() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Tax Center</h1>
        <p className="page-description">VAT, SSCL, WHT/AIT and APIT filings — all figures from the tax sub-ledger (LKR).</p>
      </div>
      <Tabs defaultValue="vat">
        <TabsList>
          <TabsTrigger value="vat">VAT Return</TabsTrigger>
          <TabsTrigger value="sscl">SSCL</TabsTrigger>
          <TabsTrigger value="wht">WHT</TabsTrigger>
          <TabsTrigger value="apit">APIT</TabsTrigger>
          <TabsTrigger value="liabilities">Liabilities</TabsTrigger>
        </TabsList>
        <TabsContent value="vat" className="mt-4"><VatReturnTab /></TabsContent>
        <TabsContent value="sscl" className="mt-4"><SsclTab /></TabsContent>
        <TabsContent value="wht" className="mt-4"><WhtTab /></TabsContent>
        <TabsContent value="apit" className="mt-4"><ApitTab /></TabsContent>
        <TabsContent value="liabilities" className="mt-4"><LiabilitiesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
