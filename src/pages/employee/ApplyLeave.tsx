import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, eachDayOfInterval, parseISO, getDay } from "date-fns";
import { toast } from "sonner";
import { CalendarPlus, AlertTriangle, CalendarRange, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useMyEmployee } from "@/hooks/useMyEmployee";
import { useLeaveTypes, useLeaveBalances, useCreateLeaveRequest, useLeaveRequests } from "@/hooks/useLeave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function ApplyLeave() {
  const navigate = useNavigate();
  const { isEmployee } = useAuth();
  const { data: me } = useMyEmployee();
  const { data: types } = useLeaveTypes();
  const { data: balances } = useLeaveBalances();
  const { data: requests } = useLeaveRequests();
  const createReq = useCreateLeaveRequest();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    leave_type_id: "", start_date: "", end_date: "",
    is_half_day: false, half_day_period: "morning", reason: "",
  });
  const set = (k: keyof typeof form, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Days already covered by the employee's own approved/pending/settled leave.
  // Admins can read the whole tenant's requests, so filter to own explicitly.
  const bookedDates = useMemo(() => {
    const out: Date[] = [];
    (requests ?? []).forEach((r: any) => {
      if (me?.id && r.employee_id !== me.id) return;
      if (!["pending", "approved", "settled"].includes(r.status)) return;
      eachDayOfInterval({ start: parseISO(r.start_date), end: parseISO(r.end_date) }).forEach((d) => out.push(d));
    });
    return out;
  }, [requests, me?.id]);

  // Show every active leave type with its balance — fall back to the type's
  // default quota when the employee has no balance row yet (created on approval).
  const balanceRows = useMemo(() => {
    // Admins can read the whole tenant's balances — keep only our own rows.
    const own = (balances ?? []).filter((b: any) => !me?.id || b.employee_id === me.id);
    const byType = new Map(own.map((b: any) => [b.leave_type_id, b]));
    return (types ?? [])
      .filter((t: any) => t.is_active !== false)
      .map((t: any) => {
        const b = byType.get(t.id);
        const entitled = b ? Number(b.entitled) + Number(b.carried_forward || 0) + Number(b.adjustment || 0) : Number(t.default_annual_quota ?? 0);
        const available = b ? Number(b.available) : Number(t.default_annual_quota ?? 0);
        return { id: t.id, name: t.name, color: t.color, is_paid: t.is_paid, entitled, available };
      });
  }, [types, balances, me?.id]);

  const balanceFor = (typeId: string) =>
    balanceRows.find((b) => b.id === typeId)?.available ?? null;

  // Set of ISO dates the employee has already booked (for overlap detection).
  const bookedSet = useMemo(() => new Set(bookedDates.map((d) => format(d, "yyyy-MM-dd"))), [bookedDates]);

  // Live summary for the request in progress: working days (Sundays excluded),
  // balance after, and any overlap with existing requests.
  const summary = useMemo(() => {
    if (!form.start_date) return null;
    const end = form.is_half_day ? form.start_date : (form.end_date || form.start_date);
    if (end < form.start_date) return { invalid: true } as const;
    const range = eachDayOfInterval({ start: parseISO(form.start_date), end: parseISO(end) });
    const workingDays = range.filter((d) => getDay(d) !== 0); // exclude Sundays
    const days = form.is_half_day ? 0.5 : workingDays.length;
    const overlap = range.some((d) => bookedSet.has(format(d, "yyyy-MM-dd")));
    const balance = form.leave_type_id ? balanceFor(form.leave_type_id) : null;
    const after = balance != null ? balance - days : null;
    const insufficient = balance != null && days > balance;
    return { invalid: false, days, overlap, balance, after, insufficient };
  }, [form, bookedSet, balanceRows]);

  const onPickDay = (day?: Date) => {
    if (!day) return;
    const iso = format(day, "yyyy-MM-dd");
    setForm({ leave_type_id: "", start_date: iso, end_date: iso, is_half_day: false, half_day_period: "morning", reason: "" });
    setOpen(true);
  };

  const submit = async () => {
    if (!me?.id) { toast.error("Your employee profile is not linked yet"); return; }
    if (!form.leave_type_id) { toast.error("Pick a leave type"); return; }
    if (form.end_date < form.start_date) { toast.error("End date can't be before start date"); return; }
    await createReq.mutateAsync({
      employee_id: me.id,
      leave_type_id: form.leave_type_id,
      start_date: form.start_date,
      end_date: form.is_half_day ? form.start_date : form.end_date,
      is_half_day: form.is_half_day,
      half_day_period: form.is_half_day ? form.half_day_period : null,
      reason: form.reason || undefined,
    });
    setOpen(false);
    navigate("/me/leave");
  };

  return (
    <div className="px-4 sm:px-6 py-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Apply for Leave</h1>
          <p className="text-sm text-muted-foreground">Pick a date on the calendar to request leave</p>
        </div>
        <Button onClick={() => onPickDay(new Date())}><CalendarPlus className="w-4 h-4" /> New Request</Button>
      </div>

      {/* Admins are subject to four-eyes approval — surface the routing rule */}
      {!isEmployee && (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 flex items-start gap-2.5 text-sm text-muted-foreground">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
          <span>
            As an administrator, your leave request must be approved by <span className="font-medium text-foreground">another administrator</span> (Payroll → Leave).
            If you're the only administrator in the company, you can approve your own request there — it's recorded as self-approved.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        {/* Calendar */}
        <div className="rounded-3xl border border-border bg-card shadow-sm p-4 sm:p-6">
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
            <CalendarPlus className="w-3.5 h-3.5" /> Click any date to request leave
          </p>
          <Calendar
            mode="single"
            onSelect={onPickDay}
            showOutsideDays
            modifiers={{ booked: bookedDates }}
            modifiersClassNames={{
              booked: "!bg-indigo-100 !text-indigo-700 dark:!bg-indigo-950/50 dark:!text-indigo-300 font-semibold ring-1 ring-inset ring-indigo-300 dark:ring-indigo-700",
            }}
            className="w-full p-0"
            classNames={{
              months: "w-full",
              month: "w-full space-y-4",
              caption: "flex justify-center pt-1 relative items-center mb-2",
              caption_label: "text-lg font-bold tracking-tight",
              nav_button: "h-9 w-9 rounded-full border border-border bg-background hover:bg-accent hover:text-accent-foreground transition-colors flex items-center justify-center",
              table: "w-full border-collapse",
              head_row: "flex w-full mb-1",
              head_cell: "flex-1 text-muted-foreground font-semibold text-[11px] uppercase tracking-wider pb-2",
              row: "flex w-full gap-1.5 mt-1.5",
              cell: "flex-1 aspect-square text-center text-sm p-0 relative",
              day: "h-full w-full rounded-2xl font-medium text-sm flex items-center justify-center transition-all duration-150 hover:bg-accent hover:text-accent-foreground hover:scale-[1.04] hover:shadow-sm cursor-pointer",
              day_today: "ring-2 ring-primary/70 ring-inset text-primary font-bold",
              day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground shadow-md",
              day_outside: "text-muted-foreground/40 hover:bg-transparent hover:scale-100",
            }}
          />
        </div>

        {/* Balances */}
        <div className="rounded-2xl border border-border bg-card shadow-sm p-5 space-y-3 h-fit">
          <h2 className="text-sm font-semibold text-foreground">Your Balances</h2>
          <div className="space-y-2.5">
            {balanceRows.length === 0 && <p className="text-xs text-muted-foreground">No leave types configured.</p>}
            {balanceRows.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 text-muted-foreground min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: b.color || "hsl(var(--primary))" }} />
                  <span className="truncate">{b.name}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-semibold text-foreground">{b.available}</span>
                  <span className="text-muted-foreground"> / {b.entitled}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-border flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-3 h-3 rounded bg-indigo-100 dark:bg-indigo-950/50 ring-1 ring-indigo-300 dark:ring-indigo-700 inline-block" />
            Days you've already booked
          </div>
        </div>
      </div>

      {/* Request dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request leave{form.start_date ? ` — ${format(parseISO(form.start_date), "d MMM yyyy")}` : ""}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div>
              <Label>Leave Type *</Label>
              <Select value={form.leave_type_id} onValueChange={(v) => set("leave_type_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select a leave type" /></SelectTrigger>
                <SelectContent>
                  {(types ?? []).filter((t: any) => t.is_active !== false).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.leave_type_id && balanceFor(form.leave_type_id) != null && (
                <p className="text-xs text-muted-foreground mt-1">
                  Available balance: <span className="font-semibold text-foreground">{balanceFor(form.leave_type_id)}</span> day(s)
                </p>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_half_day} onChange={(e) => set("is_half_day", e.target.checked)} />
              Half-day request
            </label>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
              </div>
              {form.is_half_day ? (
                <div>
                  <Label>Period</Label>
                  <Select value={form.half_day_period} onValueChange={(v) => set("half_day_period", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="morning">Morning</SelectItem>
                      <SelectItem value="afternoon">Afternoon</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div>
                  <Label>End Date</Label>
                  <Input type="date" value={form.end_date} min={form.start_date} onChange={(e) => set("end_date", e.target.value)} />
                </div>
              )}
            </div>

            {/* Live request summary */}
            {summary && !summary.invalid && (
              <div className="rounded-xl border border-border bg-muted/40 p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-muted-foreground"><CalendarRange className="w-3.5 h-3.5" /> Days requested</span>
                  <span className="font-semibold text-foreground tabular-nums">{summary.days}</span>
                </div>
                {summary.balance != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Balance after</span>
                    <span className={`font-semibold tabular-nums ${summary.insufficient ? "text-destructive" : "text-foreground"}`}>
                      {summary.after} day(s)
                    </span>
                  </div>
                )}
                {summary.insufficient && (
                  <p className="flex items-start gap-1.5 text-xs text-destructive"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> This exceeds your available balance.</p>
                )}
                {summary.overlap && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Overlaps a leave request you've already made.</p>
                )}
              </div>
            )}

            <div>
              <Label>Reason</Label>
              <Textarea value={form.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Optional note for your manager" />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={createReq.isPending || summary?.overlap || (summary && !summary.invalid && summary.days === 0)}>
                {createReq.isPending ? "Submitting…" : "Submit Request"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
