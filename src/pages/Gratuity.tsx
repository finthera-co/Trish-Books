import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { KpiCard } from "@/components/ui/KpiCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Landmark, ShieldCheck, Clock, FileText } from "lucide-react";
import {
  useGratuitySettings, useSaveGratuitySettings, useGratuitySchedule,
  useGratuityProvisions, usePostGratuityProvision, useFinalSettlement,
  useBonusSettings, useSaveBonusSettings, useBonusProvisions, usePostBonusProvision,
} from "@/hooks/useGratuity";
import { useEmployees } from "@/hooks/useData";
import { formatDate } from "@/lib/format";

const fmt = (n: number) => `LKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function Gratuity() {
  const { data: settings } = useGratuitySettings();
  const saveSettings = useSaveGratuitySettings();
  const { data: schedule, isLoading } = useGratuitySchedule();
  const { data: provisions } = useGratuityProvisions();
  const postProvision = usePostGratuityProvision();

  const [mpy, setMpy] = useState("0.5");
  const [elig, setElig] = useState("5");
  const [fromStart, setFromStart] = useState(true);
  const [termRelief, setTermRelief] = useState("0");
  const [termRate, setTermRate] = useState("0");
  const [period, setPeriod] = useState(format(new Date(), "yyyy-MM"));
  const [settleEmp, setSettleEmp] = useState("");
  const { data: employees } = useEmployees();
  const { data: settlement } = useFinalSettlement(settleEmp || undefined);

  // Bonus provision
  const { data: bonusSettings } = useBonusSettings();
  const saveBonus = useSaveBonusSettings();
  const { data: bonusProvisions } = useBonusProvisions();
  const postBonus = usePostBonusProvision();
  const [bonusMonths, setBonusMonths] = useState("1");
  const [bonusPeriod, setBonusPeriod] = useState(format(new Date(), "yyyy-MM"));
  useEffect(() => { if (bonusSettings) setBonusMonths(String(bonusSettings.bonus_months ?? 1)); }, [bonusSettings]);
  useEffect(() => {
    if (!settings) return;
    setMpy(String(settings.months_per_year ?? 0.5));
    setElig(String(settings.eligibility_years ?? 5));
    setFromStart(!!settings.accrue_from_start);
    setTermRelief(String(settings.terminal_tax_relief ?? 0));
    setTermRate(String((settings.terminal_tax_rate ?? 0) * 100)); // store fraction, show %
  }, [settings]);

  const totals = useMemo(() => {
    const rows = schedule ?? [];
    const liability = rows.reduce((s, r) => s + r.accrued_amount, 0);
    const eligibleCount = rows.filter((r) => r.eligible).length;
    return { liability, eligibleCount, total: rows.length };
  }, [schedule]);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Gratuity</h1>
          <p className="page-description">Payment of Gratuity Act — accrued liability per employee and the monthly provision.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Total accrued liability" value={fmt(totals.liability)} sublabel="current provision" icon={Landmark} tone="violet" />
        <KpiCard label="Eligible employees" value={totals.eligibleCount} sublabel={`of ${totals.total} (5+ yrs)`} icon={ShieldCheck} tone="success" />
        <KpiCard label="Provisions posted" value={provisions?.length ?? 0} sublabel="monthly accruals" icon={Clock} tone="info" />
      </div>

      {/* Policy */}
      <Card>
        <CardHeader><CardTitle className="text-base">Gratuity policy</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl">
            <div>
              <Label>Months' wage per year</Label>
              <Input type="number" min="0" step="0.25" value={mpy} onChange={(e) => setMpy(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Statutory default ½ month.</p>
            </div>
            <div>
              <Label>Eligibility (years)</Label>
              <Input type="number" min="0" step="1" value={elig} onChange={(e) => setElig(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Vests after this many years.</p>
            </div>
            <div className="flex flex-col justify-end pb-1">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={fromStart} onCheckedChange={setFromStart} />
                Accrue from year 1
              </label>
              <p className="text-[11px] text-muted-foreground mt-1">Else only once eligible.</p>
            </div>
          </div>
          <Button
            size="sm"
            disabled={saveSettings.isPending}
            onClick={() => saveSettings.mutate({ months_per_year: Number(mpy) || 0.5, eligibility_years: Number(elig) || 5, accrue_from_start: fromStart, terminal_tax_relief: Number(termRelief) || 0, terminal_tax_rate: (Number(termRate) || 0) / 100 })}
          >
            {saveSettings.isPending ? "Saving..." : "Save policy"}
          </Button>
          <div className="grid grid-cols-2 gap-4 max-w-md pt-2 border-t">
            <div>
              <Label>Terminal-benefit tax relief</Label>
              <Input type="number" min="0" value={termRelief} onChange={(e) => setTermRelief(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Tax-free portion of gratuity (APIT).</p>
            </div>
            <div>
              <Label>Concessionary rate (%)</Label>
              <Input type="number" min="0" step="0.1" value={termRate} onChange={(e) => setTermRate(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">On gratuity above the relief. Verify vs IRD.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Monthly provision */}
      <Card>
        <CardHeader><CardTitle className="text-base">Post monthly provision</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Posts a journal entry for this month's gratuity accrual: <strong>Dr Gratuity Expense / Cr Gratuity Provision</strong>.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Period</Label>
              <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-44" />
            </div>
            <Button size="sm" disabled={postProvision.isPending || !period} onClick={() => postProvision.mutate(period)}>
              {postProvision.isPending ? "Posting..." : "Post provision"}
            </Button>
          </div>
          {provisions && provisions.length > 0 && (
            <div className="rounded-md border overflow-x-auto mt-2">
              <table className="data-table text-xs">
                <thead><tr><th>Period</th><th className="text-right">Amount</th><th className="text-right">Employees</th><th>Posted</th></tr></thead>
                <tbody>
                  {provisions.map((p) => (
                    <tr key={p.id}>
                      <td>{p.period}</td>
                      <td className="text-right">{fmt(p.total_amount)}</td>
                      <td className="text-right">{p.employee_count}</td>
                      <td className="text-muted-foreground">{formatDate(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bonus provision */}
      <Card>
        <CardHeader><CardTitle className="text-base">Annual bonus provision</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Accrue the year-end bonus monthly: <strong>Dr Bonus Expense / Cr Bonus Provision</strong> = bonus months ÷ 12 × salary.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Annual bonus (months' salary)</Label>
              <Input type="number" min="0" step="0.5" value={bonusMonths} onChange={(e) => setBonusMonths(e.target.value)} className="w-40" />
            </div>
            <Button size="sm" variant="outline" disabled={saveBonus.isPending} onClick={() => saveBonus.mutate(Number(bonusMonths) || 1)}>
              {saveBonus.isPending ? "Saving..." : "Save"}
            </Button>
            <div>
              <Label>Period</Label>
              <Input type="month" value={bonusPeriod} onChange={(e) => setBonusPeriod(e.target.value)} className="w-44" />
            </div>
            <Button size="sm" disabled={postBonus.isPending || !bonusPeriod} onClick={() => postBonus.mutate(bonusPeriod)}>
              {postBonus.isPending ? "Posting..." : "Post provision"}
            </Button>
          </div>
          {bonusProvisions && bonusProvisions.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Last: {bonusProvisions[0].period} · {fmt(bonusProvisions[0].total_amount)} ({bonusProvisions.length} posted)
            </p>
          )}
        </CardContent>
      </Card>

      {/* Final settlement */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" />Final settlement (end of service)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="max-w-md">
            <Label>Employee</Label>
            <Select value={settleEmp} onValueChange={setSettleEmp}>
              <SelectTrigger><SelectValue placeholder="Select an employee…" /></SelectTrigger>
              <SelectContent>
                {employees?.map((e: any) => (
                  <SelectItem key={e.id} value={e.id}>{(e.employee_number ? `${e.employee_number} — ` : "")}{e.first_name} {e.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {settlement && (
            <div className="rounded-md border divide-y max-w-md text-sm">
              {[
                ["Years of service", `${settlement.years_of_service?.toFixed?.(1) ?? settlement.years_of_service}`],
                [`Gratuity${settlement.gratuity_eligible ? "" : " (not eligible)"}`, fmt(settlement.gratuity_amount)],
                ...(Number(settlement.gratuity_tax) > 0 ? [["Less: gratuity APIT", `-${fmt(settlement.gratuity_tax)}`] as [string, string]] : []),
                [`Leave encashment (${settlement.encashable_leave_days} days)`, fmt(settlement.leave_encashment)],
                ["Less: outstanding loan", `-${fmt(settlement.outstanding_loan)}`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between px-3 py-2"><span className="text-muted-foreground">{k}</span><span className="tabular-nums">{v}</span></div>
              ))}
              <div className="flex justify-between px-3 py-2 font-semibold bg-muted/40">
                <span>Net settlement</span><span className="tabular-nums text-primary">{fmt(settlement.net_settlement)}</span>
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">Computation only — post the settlement payment as a manual journal (Dr Gratuity Provision + leave/cash, Cr Bank, settle loan).</p>
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card>
        <CardHeader><CardTitle className="text-base">Accrued gratuity by employee</CardTitle></CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <table className="data-table text-sm">
              <thead>
                <tr>
                  <th>Employee</th><th>Hire date</th><th className="text-right">Years</th>
                  <th className="text-right">Monthly salary</th><th className="text-right">Accrued liability</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</td></tr>
                ) : !schedule?.length ? (
                  <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">No employees with a hire date.</td></tr>
                ) : schedule.map((r) => (
                  <tr key={r.employee_id}>
                    <td className="font-medium text-foreground">
                      {r.employee_name}{r.employee_number && <span className="text-muted-foreground text-xs ml-1">({r.employee_number})</span>}
                    </td>
                    <td className="text-muted-foreground">{r.hire_date || "—"}</td>
                    <td className="text-right tabular-nums">{r.years_of_service.toFixed(1)}</td>
                    <td className="text-right tabular-nums">{fmt(r.monthly_salary)}</td>
                    <td className="text-right tabular-nums font-medium">{fmt(r.accrued_amount)}</td>
                    <td>{r.eligible
                      ? <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Eligible</Badge>
                      : <Badge variant="outline" className="text-muted-foreground">Not yet</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Accrued liability = months' wage/year × monthly salary × years of service. Payable on termination to employees with {elig}+ years' service.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
