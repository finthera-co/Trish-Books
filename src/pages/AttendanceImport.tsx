import { useMemo, useState, useEffect } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useDeviceProfiles, useSaveDeviceProfile, useImportPunches, useAggregateBatch,
  useOverlappingBatches, useSetBiometricId, useDefaultWorkShift, useSaveStandardHours,
} from "@/hooks/useAttendance";
import { useEmployees } from "@/hooks/useData";
import {
  autoDetect, parsePunchAt, resolveDirection, debouncePunches,
  type MappingConfig, type ResolvedDirection, type DateOrder,
} from "@/lib/attendanceMapping";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Upload, CheckCircle2, AlertTriangle, Sparkles, Wand2, Clock } from "lucide-react";
import { formatDate } from "@/lib/format";

const NONE = "__none__";

type ImportType = "daily" | "weekly" | "monthly";

// Shift an ISO date (yyyy-mm-dd) by n days using local components — no timezone drift.
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// Resolve the fixed import window from the chosen cadence + anchor.
// Daily = one day; Weekly = anchor..anchor+6; Monthly = whole calendar month.
function computePeriod(type: ImportType, anchorDate: string, anchorMonth: string): { start: string; end: string } {
  if (type === "monthly") {
    if (!anchorMonth) return { start: "", end: "" };
    const [y, m] = anchorMonth.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return { start: `${anchorMonth}-01`, end: `${anchorMonth}-${String(last).padStart(2, "0")}` };
  }
  if (!anchorDate) return { start: "", end: "" };
  if (type === "daily") return { start: anchorDate, end: anchorDate };
  return { start: anchorDate, end: addDays(anchorDate, 6) }; // weekly
}

interface PunchEntry {
  raw_device_id: string;
  punch_at: string | null;
  direction: ResolvedDirection;
  raw_row: Record<string, string>;
  employee_id: string | null;
}

// Resolve directions chronologically per device (inferred alternates; explicit reads the column).
function resolveDirections(entries: PunchEntry[], cfg: MappingConfig): void {
  const byDevice: Record<string, PunchEntry[]> = {};
  entries.forEach((e) => { if (e.punch_at) (byDevice[e.raw_device_id] ??= []).push(e); });
  Object.values(byDevice).forEach((list) => {
    list.sort((a, b) => (a.punch_at! < b.punch_at! ? -1 : 1));
    const toggle = { next: "in" as ResolvedDirection };
    list.forEach((e) => { e.direction = resolveDirection(e.raw_row, cfg, toggle); });
  });
}

export default function AttendanceImport() {
  const { data: profiles } = useDeviceProfiles();
  const { data: employees } = useEmployees();
  const saveProfile = useSaveDeviceProfile();
  const importPunches = useImportPunches();
  const aggregate = useAggregateBatch();
  const setBiometric = useSetBiometricId();
  const { data: defaultShift } = useDefaultWorkShift();
  const saveStandardHours = useSaveStandardHours();

  // Standard working hours config (drives OT during aggregation).
  const [stdHours, setStdHours] = useState("8");
  const [breakMins, setBreakMins] = useState("60");
  const [otMult, setOtMult] = useState("1.5");
  const [breakAfter, setBreakAfter] = useState("6");
  const [halfDayHours, setHalfDayHours] = useState("4");
  const [holidayMult, setHolidayMult] = useState("2");
  const [otInclAllow, setOtInclAllow] = useState(false);
  const [deductUndertime, setDeductUndertime] = useState(false);
  const [otCap, setOtCap] = useState("0");
  useEffect(() => {
    if (defaultShift === undefined) return; // still loading
    if (defaultShift) {
      const s = defaultShift as any;
      setStdHours(String(s.ot_threshold_hours ?? s.standard_hours ?? 8));
      setBreakMins(String(s.break_minutes ?? 60));
      setOtMult(String(s.ot_multiplier ?? 1.5));
      setBreakAfter(String(s.break_after_hours ?? 6));
      setHalfDayHours(String(s.half_day_hours ?? 4));
      setHolidayMult(String(s.holiday_ot_multiplier ?? 2));
      setOtInclAllow(!!s.ot_includes_allowances);
      setDeductUndertime(!!s.deduct_undertime);
      setOtCap(String(s.ot_cap_hours ?? 0));
    }
  }, [defaultShift]);

  const [fileName, setFileName] = useState("");
  const [fileFormat, setFileFormat] = useState<"csv" | "xlsx">("csv");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [cfg, setCfg] = useState<MappingConfig | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);

  const [profileId, setProfileId] = useState<string>(NONE);
  const [importType, setImportType] = useState<ImportType>("monthly");
  const [anchorDate, setAnchorDate] = useState(""); // daily / weekly anchor (yyyy-mm-dd)
  const [anchorMonth, setAnchorMonth] = useState(""); // monthly anchor (yyyy-mm)
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [acknowledgedOverlap, setAcknowledgedOverlap] = useState(false);

  const [committedBatchId, setCommittedBatchId] = useState<string | null>(null);
  const [collapsedCount, setCollapsedCount] = useState(0);

  // Phase 11: warn before unload while a file is parsed but not yet committed,
  // and persist the (small) mapping config so a refresh + re-upload is pre-filled.
  const { appUser } = useAuth();
  const scope = appUser ? `${appUser.tenant_id}:${appUser.id}` : undefined;
  const { value: savedCfg, setValue: setSavedCfg, clearDraft: clearCfg } =
    useDraftPersistence<{ cfg: MappingConfig; importType: ImportType; anchorDate: string; anchorMonth: string } | null>({
      page: "attendance-import-config", scope, initial: null,
    });
  const [restoredCfg, setRestoredCfg] = useState(false);

  const hasPendingImport = rows.length > 0 && !committedBatchId;
  useUnsavedChangesWarning(hasPendingImport);

  // Restore the saved mapping once on mount, before any file is loaded.
  useEffect(() => {
    if (savedCfg && !cfg) {
      setCfg(savedCfg.cfg);
      if (savedCfg.importType) setImportType(savedCfg.importType);
      if (savedCfg.anchorDate) setAnchorDate(savedCfg.anchorDate);
      if (savedCfg.anchorMonth) setAnchorMonth(savedCfg.anchorMonth);
      setRestoredCfg(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchCfg = (patch: Partial<MappingConfig>) => setCfg((c) => (c ? { ...c, ...patch } : c));
  const patchMapping = (patch: Partial<MappingConfig["mapping"]>) =>
    setCfg((c) => (c ? { ...c, mapping: { ...c.mapping, ...patch } } : c));

  // ---- File parsing ------------------------------------------------------
  const handleFile = async (file: File) => {
    setCommittedBatchId(null);
    setAcknowledgedOverlap(false);
    setProfileId(NONE);
    setFileName(file.name);
    const ext = file.name.split(".").pop()?.toLowerCase();
    const applyParsed = (hdrs: string[], data: Record<string, string>[]) => {
      setHeaders(hdrs);
      setRows(data);
      // Keep a restored mapping (from a prior refresh) instead of re-detecting.
      if (restoredCfg && cfg) { setRestoredCfg(false); setAutoDetected(false); return; }
      const detected = autoDetect(hdrs);
      setCfg(detected);
      setAutoDetected(true);
    };
    try {
      if (ext === "csv") {
        setFileFormat("csv");
        Papa.parse<Record<string, string>>(file, {
          header: true, skipEmptyLines: true,
          complete: (res) => applyParsed(res.meta.fields || [], res.data as Record<string, string>[]),
          error: (err) => toast.error(`CSV parse failed: ${err.message}`),
        });
      } else {
        setFileFormat("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
        const hdrs = json.length ? Object.keys(json[0]) : [];
        applyParsed(hdrs, json.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")]))));
      }
    } catch (e: any) {
      toast.error(`Failed to read file: ${e.message}`);
    }
  };

  // ---- Apply a saved profile (overrides auto-detect) ---------------------
  const applyProfile = (id: string) => {
    setProfileId(id);
    if (id === NONE) return;
    const p = profiles?.find((x: any) => x.id === id);
    if (!p) return;
    const cm = (p.column_mapping || {}) as Partial<MappingConfig["mapping"]>;
    setCfg({
      mapping: {
        device_id: cm.device_id ?? null, date: cm.date ?? null, time: cm.time ?? null,
        datetime: cm.datetime ?? null, direction: cm.direction ?? null,
      },
      has_separate_date_time: !!p.has_separate_date_time,
      direction_mode: p.direction_mode === "explicit" ? "explicit" : "inferred",
      in_values: p.in_values || [],
      out_values: p.out_values || [],
      debounce_seconds: p.debounce_seconds ?? 60,
      date_order: (p.date_order as DateOrder) || "DMY",
    });
    setAutoDetected(false);
  };

  // ---- Employee biometric map -------------------------------------------
  const biometricMap = useMemo(() => {
    const m = new Map<string, any>();
    (employees || []).forEach((e: any) => { if (e.biometric_id) m.set(String(e.biometric_id).trim(), e); });
    return m;
  }, [employees]);

  // ---- Full-file model (drives gates, preview, period) -------------------
  const model = useMemo(() => {
    if (!cfg || !cfg.mapping.device_id || rows.length === 0) {
      return { entries: [] as PunchEntry[], total: 0, failCount: 0, matchedCount: 0, unmatchedIds: [] as string[] };
    }
    const entries: PunchEntry[] = rows.map((row) => {
      const rawId = String(row[cfg.mapping.device_id!] ?? "").trim();
      const punch_at = parsePunchAt(row, cfg);
      const emp = rawId ? biometricMap.get(rawId) : undefined;
      return { raw_device_id: rawId, punch_at, direction: "unknown" as ResolvedDirection, raw_row: row, employee_id: emp?.id ?? null };
    });
    resolveDirections(entries, cfg);
    const failCount = entries.filter((e) => !e.punch_at).length;
    const matchedCount = entries.filter((e) => e.employee_id).length;
    const unmatchedIds = Array.from(new Set(entries.filter((e) => !e.employee_id && e.raw_device_id).map((e) => e.raw_device_id)));
    return { entries, total: entries.length, failCount, matchedCount, unmatchedIds };
  }, [cfg, rows, biometricMap]);

  // Actual span of the file's punches — used to auto-fill the anchor and to detect mismatches.
  const derivedPeriod = useMemo(() => {
    const dates = model.entries.filter((e) => e.punch_at).map((e) => e.punch_at!.slice(0, 10)).sort();
    return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : { start: "", end: "" };
  }, [model.entries]);

  // The import window is fixed by the chosen cadence — no arbitrary ranges.
  const period = useMemo(() => computePeriod(importType, anchorDate, anchorMonth), [importType, anchorDate, anchorMonth]);
  const effStart = period.start;
  const effEnd = period.end;

  // Auto-fill the anchor from the first parsed punch (only when not already set / restored).
  useEffect(() => {
    if (!derivedPeriod.start) return;
    if (importType === "monthly") { if (!anchorMonth) setAnchorMonth(derivedPeriod.start.slice(0, 7)); }
    else if (!anchorDate) setAnchorDate(derivedPeriod.start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedPeriod.start, importType]);

  // Punches that fall outside the selected window — these are excluded from the commit.
  const windowStats = useMemo(() => {
    if (!effStart || !effEnd) return { inWindow: 0, outOfWindow: 0 };
    let inWindow = 0, outOfWindow = 0;
    model.entries.forEach((e) => {
      if (!e.punch_at) return;
      const d = e.punch_at.slice(0, 10);
      if (d >= effStart && d <= effEnd) inWindow++; else outOfWindow++;
    });
    return { inWindow, outOfWindow };
  }, [model.entries, effStart, effEnd]);

  const { data: overlaps } = useOverlappingBatches(effStart || undefined, effEnd || undefined);

  // Mirror the lightweight config so a refresh restores the mapping (never the rows/file).
  useEffect(() => {
    if (cfg && headers.length > 0) setSavedCfg({ cfg, importType, anchorDate, anchorMonth });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, importType, anchorDate, anchorMonth, headers.length]);

  // ---- Validation gates --------------------------------------------------
  const deviceIdMapped = !!cfg?.mapping.device_id;
  const dateMapped = !!cfg && (cfg.has_separate_date_time ? (!!cfg.mapping.date && !!cfg.mapping.time) : !!cfg.mapping.datetime);
  const parseFailureRate = model.total > 0 ? model.failCount / model.total : 0;
  const parseOk = model.total > 0 && parseFailureRate < 0.2;
  const anyMatched = model.matchedCount > 0;
  const periodSet = !!effStart && !!effEnd;
  const inWindowOk = windowStats.inWindow > 0;
  const hasOverlap = !!overlaps && overlaps.length > 0;
  const overlapOk = !hasOverlap || acknowledgedOverlap;
  const canImport = deviceIdMapped && dateMapped && parseOk && anyMatched && periodSet && inWindowOk && overlapOk;

  const periodLabel = importType === "daily" ? "day" : importType === "weekly" ? "week" : "month";
  const gateReason = !deviceIdMapped ? "Map the Device ID column."
    : !dateMapped ? "Map the date/time column(s)."
    : model.total === 0 ? "No data rows parsed."
    : !parseOk ? `${model.failCount} of ${model.total} rows have unreadable dates (${Math.round(parseFailureRate * 100)}%) — the date column is likely wrong.`
    : !anyMatched ? "Zero employees matched — the Device ID column is likely wrong, or no employees have a biometric ID set."
    : !periodSet ? `Select the ${periodLabel} to import.`
    : !inWindowOk ? `No punches fall within the selected ${periodLabel} — pick the ${periodLabel} that matches this file.`
    : !overlapOk ? "A batch for this period already exists — acknowledge the overlap warning to continue."
    : "";

  const previewSample = model.entries.slice(0, 10);

  // ---- Commit ------------------------------------------------------------
  const handleImport = async () => {
    if (!cfg) return;
    // Only commit punches inside the selected cadence window — the window, not the file, defines the period.
    const valid: PunchEntry[] = model.entries.filter((e) => {
      if (!e.punch_at) return false;
      const d = e.punch_at.slice(0, 10);
      return d >= effStart && d <= effEnd;
    });
    const list = valid.map((e) => ({
      raw_device_id: e.raw_device_id, punch_at: e.punch_at!, direction: e.direction,
      raw_row: e.raw_row, employee_id: e.employee_id,
    }));
    const { kept, collapsed } = debouncePunches(list, cfg.debounce_seconds);
    setCollapsedCount(collapsed);
    const batch = await importPunches.mutateAsync({
      fileName, fileFormat, deviceProfileId: profileId !== NONE ? profileId : null,
      periodStart: effStart || undefined, periodEnd: effEnd || undefined, rows: kept,
    });
    setCommittedBatchId(batch.id);
    clearCfg();
    toast.success("Punches imported");
    // Auto-aggregate straight away so worked/OT hours are computed without a
    // second click and are immediately ready for payroll Step 2.
    try {
      await aggregate.mutateAsync(batch.id);
    } catch {
      /* aggregate hook surfaces its own error toast; user can re-run below */
    }
  };

  const handleSaveProfile = async () => {
    if (!cfg) return;
    if (!profileName.trim()) { toast.error("Enter a profile name"); return; }
    await saveProfile.mutateAsync({
      name: profileName.trim(), file_format: fileFormat,
      column_mapping: cfg.mapping, has_separate_date_time: cfg.has_separate_date_time,
      direction_mode: cfg.direction_mode, in_values: cfg.in_values, out_values: cfg.out_values,
      debounce_seconds: cfg.debounce_seconds, date_order: cfg.date_order,
    });
    setSavingProfile(false);
    setProfileName("");
  };

  const linkEmployee = (deviceId: string, employeeId: string) => {
    if (!employeeId || employeeId === NONE) return;
    // Guard a silent re-enrollment: the chosen employee is already linked to a different machine ID.
    const chosen = employees?.find((e: any) => e.id === employeeId);
    if (chosen?.biometric_id && chosen.biometric_id.trim() !== deviceId.trim()) {
      toast.error(`${chosen.first_name} is already linked to device ID ${chosen.biometric_id}. Update it on the linking screen if this is a re-enrollment.`);
      return;
    }
    setBiometric.mutate({ employeeId, biometricId: deviceId });
  };

  const columnSelect = (value: string | null, onChange: (v: string | null) => void, allowNone = false, disabled = false) => (
    <Select value={value || (allowNone ? NONE : "")} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger><SelectValue placeholder="Select column" /></SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>— none —</SelectItem>}
        {headers.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const dirPill = (d: ResolvedDirection) => {
    const cls = d === "in" ? "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300"
      : d === "out" ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
      : "bg-muted text-muted-foreground";
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>{d}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Import Attendance</h1>
          <p className="page-description">Upload a biometric device export — columns are auto-detected, validated, and matched to employees.</p>
        </div>
      </div>

      {/* Standard working hours — drives OT during aggregation */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" />Standard working hours</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Overtime is any time worked beyond the standard daily hours. Set your company's standard here — it's applied automatically when attendance is aggregated, and the resulting worked &amp; OT hours flow into payroll Step&nbsp;2.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl">
            <div>
              <Label>Standard hours / day</Label>
              <Input type="number" min="0" step="0.5" value={stdHours} onChange={(e) => setStdHours(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Hours beyond this count as OT.</p>
            </div>
            <div>
              <Label>Unpaid break (minutes)</Label>
              <Input type="number" min="0" step="5" value={breakMins} onChange={(e) => setBreakMins(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Deducted only past the break threshold.</p>
            </div>
            <div>
              <Label>OT multiplier</Label>
              <Input type="number" min="1" step="0.1" value={otMult} onChange={(e) => setOtMult(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">OT pay = rate × this (e.g. 1.5×).</p>
            </div>
            <div>
              <Label>Deduct break after (hours)</Label>
              <Input type="number" min="0" step="0.5" value={breakAfter} onChange={(e) => setBreakAfter(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Shorter days aren't docked a break.</p>
            </div>
            <div>
              <Label>Half-day under (hours)</Label>
              <Input type="number" min="0" step="0.5" value={halfDayHours} onChange={(e) => setHalfDayHours(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Worked below this = half day.</p>
            </div>
            <div>
              <Label>Holiday / rest-day OT ×</Label>
              <Input type="number" min="1" step="0.1" value={holidayMult} onChange={(e) => setHolidayMult(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Rate for work on off-days / holidays.</p>
            </div>
            <div>
              <Label>OT cap (hours / period)</Label>
              <Input type="number" min="0" step="1" value={otCap} onChange={(e) => setOtCap(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Compliance warning if exceeded. 0 = none.</p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={otInclAllow} onCheckedChange={(c) => setOtInclAllow(!!c)} />
            Base overtime on basic + allowances (otherwise basic only)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={deductUndertime} onCheckedChange={(c) => setDeductUndertime(!!c)} />
            Deduct undertime — late minutes reduce a salaried employee's paid days
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={saveStandardHours.isPending || !stdHours}
              onClick={() => saveStandardHours.mutate({
                standard_hours: Number(stdHours) || 0,
                break_minutes: Number(breakMins) || 0,
                ot_multiplier: Number(otMult) || 1.5,
                break_after_hours: Number(breakAfter) || 0,
                half_day_hours: Number(halfDayHours) || 0,
                holiday_ot_multiplier: Number(holidayMult) || 2,
                ot_includes_allowances: otInclAllow,
                deduct_undertime: deductUndertime,
                ot_cap_hours: Number(otCap) || 0,
              })}
            >
              {saveStandardHours.isPending ? "Saving..." : "Save standard hours"}
            </Button>
            {defaultShift && (
              <span className="text-[11px] text-muted-foreground">
                Current: {Number((defaultShift as any).ot_threshold_hours ?? 8)} h/day · {Number((defaultShift as any).break_minutes ?? 0)} min break · OT {Number((defaultShift as any).ot_multiplier ?? 1.5)}×
              </span>
            )}
          </div>
          <p className="text-[11px] text-amber-600">
            Already imported &amp; aggregated this period? Re-run aggregation after changing these so OT recalculates.
          </p>
        </CardContent>
      </Card>

      {/* Section A — Upload & profile */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Upload className="w-4 h-4" />1. Upload &amp; profile</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Saved device profile</Label>
              <Select value={profileId} onValueChange={applyProfile}>
                <SelectTrigger><SelectValue placeholder="None — auto-detect" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None — auto-detect</SelectItem>
                  {profiles?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>File (.csv, .xlsx, .xls)</Label>
              <Input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>
          </div>
          {restoredCfg && !fileName && (
            <p className="text-sm text-amber-600">Restored your last column mapping — re-select the file to continue.</p>
          )}
          {fileName && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{fileName} — {rows.length} rows, {headers.length} columns.</span>
              {autoDetected && <Badge variant="outline" className="text-primary border-primary/40"><Sparkles className="w-3 h-3 mr-1" />Auto-detected — please confirm</Badge>}
              {profileId !== NONE && <Badge variant="secondary">Profile: {profiles?.find((p: any) => p.id === profileId)?.name}</Badge>}
            </div>
          )}
        </CardContent>
      </Card>

      {cfg && headers.length > 0 && (
        <>
          {/* Section B — Mapping controls */}
          <Card>
            <CardHeader><CardTitle className="text-base">2. Column mapping</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Device ID *</Label>{columnSelect(cfg.mapping.device_id, (v) => patchMapping({ device_id: v }))}</div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={cfg.has_separate_date_time} onCheckedChange={(c) => {
                      const on = !!c;
                      if (on && !cfg.mapping.time) { const ad = autoDetect(headers); patchCfg({ has_separate_date_time: true, mapping: { ...cfg.mapping, time: ad.mapping.time } }); }
                      else patchCfg({ has_separate_date_time: on });
                    }} />
                    Date &amp; time in separate columns
                  </label>
                </div>
                {cfg.has_separate_date_time ? (
                  <>
                    <div><Label>Date *</Label>{columnSelect(cfg.mapping.date, (v) => patchMapping({ date: v }))}</div>
                    <div><Label>Time *</Label>{columnSelect(cfg.mapping.time, (v) => patchMapping({ time: v }))}</div>
                  </>
                ) : (
                  <div><Label>Date &amp; time (combined) *</Label>{columnSelect(cfg.mapping.datetime, (v) => patchMapping({ datetime: v }))}</div>
                )}
                <div>
                  <Label>Date format *</Label>
                  <Select value={cfg.date_order} onValueChange={(v) => patchCfg({ date_order: v as DateOrder })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DMY">Day / Month / Year (31/12/2026)</SelectItem>
                      <SelectItem value="MDY">Month / Day / Year (12/31/2026)</SelectItem>
                      <SelectItem value="YMD">Year / Month / Day (2026-12-31)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">How dates are written in this file. Check the parsed timestamps in the preview below.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Direction mode</Label>
                  <Select value={cfg.direction_mode} onValueChange={(v) => patchCfg({ direction_mode: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inferred">Inferred (alternating in/out)</SelectItem>
                      <SelectItem value="explicit">Explicit (read a direction column)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Direction column</Label>{columnSelect(cfg.mapping.direction, (v) => patchMapping({ direction: v }), true, cfg.direction_mode === "inferred")}</div>
              </div>

              {cfg.direction_mode === "explicit" && (
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>"In" values (comma-separated)</Label>
                    <Input value={cfg.in_values.join(", ")} onChange={(e) => patchCfg({ in_values: e.target.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) })} />
                  </div>
                  <div><Label>"Out" values (comma-separated)</Label>
                    <Input value={cfg.out_values.join(", ")} onChange={(e) => patchCfg({ out_values: e.target.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) })} />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div><Label>Debounce (seconds)</Label>
                  <Input type="number" value={cfg.debounce_seconds} onChange={(e) => patchCfg({ debounce_seconds: Number(e.target.value) })} />
                  <p className="text-[11px] text-muted-foreground mt-1">Collapse repeat scans within N seconds.</p>
                </div>
                <div>
                  <Label>Import type</Label>
                  <Select value={importType} onValueChange={(v) => setImportType(v as ImportType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  {importType === "monthly" ? (
                    <><Label>Month</Label><Input type="month" value={anchorMonth} onChange={(e) => setAnchorMonth(e.target.value)} /></>
                  ) : (
                    <><Label>{importType === "weekly" ? "Week starting" : "Date"}</Label><Input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} /></>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {periodSet ? `Window: ${effStart} → ${effEnd}` : "Pick the period to import into the register."}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2 border-t">
                {!savingProfile ? (
                  <Button variant="outline" size="sm" onClick={() => setSavingProfile(true)}><Wand2 className="w-4 h-4" />Save as profile</Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input className="max-w-xs" placeholder="Profile name (e.g. ZKTeco K40)" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
                    <Button size="sm" onClick={handleSaveProfile} disabled={saveProfile.isPending}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setSavingProfile(false)}>Cancel</Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Section C/D/E — Preview, gates, inline resolution */}
          {deviceIdMapped && dateMapped && (
            <Card>
              <CardHeader><CardTitle className="text-base">3. Preview &amp; validate</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">{model.matchedCount}/{model.total} matched</Badge>
                  <Badge variant="outline" className="text-amber-600 border-amber-500/50">{model.unmatchedIds.length} device IDs need linking</Badge>
                  {model.failCount > 0 && <Badge variant="outline" className="text-rose-600 border-rose-500/50">{model.failCount} unreadable dates</Badge>}
                  {windowStats.outOfWindow > 0 && <Badge variant="outline" className="text-rose-600 border-rose-500/50">{windowStats.outOfWindow} outside selected {periodLabel} (excluded)</Badge>}
                  <span className="text-[11px] text-muted-foreground">Dates read as {cfg.date_order === "DMY" ? "Day/Month/Year" : cfg.date_order === "MDY" ? "Month/Day/Year" : "Year/Month/Day"} (Asia/Colombo) — if the timestamps below look wrong, change the Date format above.</span>
                </div>

                {hasOverlap && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm space-y-2">
                    <p className="font-medium text-amber-800 dark:text-amber-300 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Overlapping batch already imported</p>
                    <p className="text-amber-700 dark:text-amber-400">
                      A batch covering this period was already imported on {formatDate(overlaps![0].created_at)} ({overlaps![0].file_name}, {overlaps![0].total_rows} rows). Importing again may double-count hours.
                    </p>
                    <label className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
                      <Checkbox checked={acknowledgedOverlap} onCheckedChange={(c) => setAcknowledgedOverlap(!!c)} /> Import anyway
                    </label>
                  </div>
                )}

                {/* Preview table */}
                <div className="rounded-md border overflow-x-auto">
                  <table className="data-table text-xs" style={{ tableLayout: "fixed" }}>
                    <thead><tr><th>Employee</th><th>Device ID</th><th>Punch timestamp</th><th>Direction</th></tr></thead>
                    <tbody>
                      {previewSample.map((e, i) => {
                        const emp = e.employee_id ? employees?.find((x: any) => x.id === e.employee_id) : null;
                        return (
                          <tr key={i}>
                            <td>{emp ? <span className="text-green-600 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{emp.first_name} {emp.last_name}</span>
                              : <span className="text-amber-600">Unmatched</span>}</td>
                            <td className="font-mono">{e.raw_device_id || "—"}</td>
                            <td className={`font-mono ${!e.punch_at ? "text-rose-600" : ""}`}>{e.punch_at ? new Date(e.punch_at).toLocaleString() : "unparseable"}</td>
                            <td>{dirPill(e.direction)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Inline biometric-ID resolution */}
                {model.unmatchedIds.length > 0 && (
                  <div className="rounded-md border p-3 space-y-2">
                    <p className="text-sm font-medium">Link unmatched device IDs to employees</p>
                    <p className="text-[11px] text-muted-foreground">Selecting an employee saves their <code>biometric_id</code> — all rows for that device flip to matched, and future imports need no linking.</p>
                    <div className="grid grid-cols-2 gap-2">
                      {model.unmatchedIds.slice(0, 50).map((did) => (
                        <div key={did} className="flex items-center gap-2">
                          <span className="font-mono text-xs w-28 shrink-0 truncate" title={did}>{did}</span>
                          <Select onValueChange={(v) => linkEmployee(did, v)}>
                            <SelectTrigger className="h-8"><SelectValue placeholder="Assign employee…" /></SelectTrigger>
                            <SelectContent>
                              {employees?.map((emp: any) => (
                                <SelectItem key={emp.id} value={emp.id}>
                                  {(emp.employee_number ? `${emp.employee_number} — ` : "")}{emp.first_name} {emp.last_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Commit */}
                {!committedBatchId ? (
                  <div className="flex items-center justify-end gap-3">
                    {!canImport && <span className="text-xs text-muted-foreground">{gateReason}</span>}
                    <Button onClick={handleImport} disabled={!canImport || importPunches.isPending}>
                      {importPunches.isPending ? "Importing..." : "Import"}
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-md border border-green-300 bg-green-50 dark:bg-green-950/20 p-3 space-y-2">
                    <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400"><CheckCircle2 className="w-4 h-4" />Batch imported.</p>
                    <p className="text-sm text-muted-foreground">
                      {model.total} rows · {model.matchedCount} matched · {model.total - model.matchedCount} unmatched · {collapsedCount} duplicate scans collapsed.
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {aggregate.isPending
                        ? "Calculating worked & OT hours…"
                        : "Worked & OT hours were calculated automatically and recorded into the Attendance Register — they're ready to pull into payroll Step 2. Changed the standard hours? Re-run to recalculate OT."}
                    </p>
                    <div className="flex justify-end">
                      <Button variant="outline" onClick={() => aggregate.mutate(committedBatchId)} disabled={aggregate.isPending}>
                        {aggregate.isPending ? "Aggregating..." : "Re-run aggregation"}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
