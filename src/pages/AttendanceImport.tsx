import { useMemo, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useDeviceProfiles, useSaveDeviceProfile, useImportPunches, useAggregateBatch,
} from "@/hooks/useAttendance";
import { useEmployees } from "@/hooks/useData";
import { toast } from "sonner";
import { Upload, CheckCircle2, AlertTriangle } from "lucide-react";

const NONE = "__none__";

type Mapping = { device_id: string; datetime: string; date: string; time: string; direction: string };
type BuiltPunch = { raw_device_id: string; punch_at: string; direction: string; raw_row: any; employee_id: string | null };

const DEFAULT_IN = ["in", "i", "0", "checkin", "check-in", "c/in"];
const DEFAULT_OUT = ["out", "o", "1", "checkout", "check-out", "c/out"];

export default function AttendanceImport() {
  const { data: profiles } = useDeviceProfiles();
  const { data: employees } = useEmployees();
  const saveProfile = useSaveDeviceProfile();
  const importPunches = useImportPunches();
  const aggregate = useAggregateBatch();

  const [fileName, setFileName] = useState("");
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<Record<string, string>[]>([]);

  const [profileId, setProfileId] = useState<string>(NONE);
  const [mapping, setMapping] = useState<Mapping>({ device_id: "", datetime: "", date: "", time: "", direction: "" });
  const [hasSeparateDateTime, setHasSeparateDateTime] = useState(false);
  const [directionMode, setDirectionMode] = useState<"explicit" | "inferred">("inferred");
  const [inValues, setInValues] = useState<string[]>(DEFAULT_IN);
  const [outValues, setOutValues] = useState<string[]>(DEFAULT_OUT);

  const [saveAsNew, setSaveAsNew] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");

  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  const [committedBatchId, setCommittedBatchId] = useState<string | null>(null);

  // ---- File parsing ------------------------------------------------------
  const handleFile = async (file: File) => {
    setCommittedBatchId(null);
    setFileName(file.name);
    const ext = file.name.split(".").pop()?.toLowerCase();
    try {
      if (ext === "csv") {
        Papa.parse<Record<string, string>>(file, {
          header: true, skipEmptyLines: true,
          complete: (res) => {
            const cols = res.meta.fields || [];
            setDetectedColumns(cols);
            setDataRows(res.data as Record<string, string>[]);
          },
          error: (err) => toast.error(`CSV parse failed: ${err.message}`),
        });
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
        const cols = json.length ? Object.keys(json[0]) : [];
        setDetectedColumns(cols);
        setDataRows(json.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")]))));
      }
    } catch (e: any) {
      toast.error(`Failed to read file: ${e.message}`);
    }
  };

  // ---- Apply a saved profile --------------------------------------------
  const applyProfile = (id: string) => {
    setProfileId(id);
    if (id === NONE) return;
    const p = profiles?.find((x: any) => x.id === id);
    if (!p) return;
    const cm = (p.column_mapping || {}) as Partial<Mapping>;
    setMapping({
      device_id: cm.device_id || "", datetime: cm.datetime || "",
      date: cm.date || "", time: cm.time || "", direction: cm.direction || "",
    });
    setHasSeparateDateTime(!!p.has_separate_date_time);
    setDirectionMode(p.direction_mode === "explicit" ? "explicit" : "inferred");
    setInValues(p.in_values || DEFAULT_IN);
    setOutValues(p.out_values || DEFAULT_OUT);
  };

  // ---- Employee biometric map -------------------------------------------
  const biometricMap = useMemo(() => {
    const m = new Map<string, string>();
    (employees || []).forEach((e: any) => {
      if (e.biometric_id) m.set(String(e.biometric_id).trim(), e.id);
    });
    return m;
  }, [employees]);

  // ---- Build punches -----------------------------------------------------
  const { punches, skipped } = useMemo(() => {
    const out: BuiltPunch[] = [];
    const skips: { row: number; reason: string }[] = [];
    if (!mapping.device_id || dataRows.length === 0) return { punches: out, skipped: skips };

    dataRows.forEach((row, idx) => {
      const rawId = String(row[mapping.device_id] ?? "").trim();
      if (!rawId) { skips.push({ row: idx + 1, reason: "missing device ID" }); return; }

      let dtStr = "";
      if (hasSeparateDateTime) {
        const d = String(row[mapping.date] ?? "").trim();
        const t = String(row[mapping.time] ?? "").trim();
        if (!d) { skips.push({ row: idx + 1, reason: "missing date" }); return; }
        dtStr = t ? `${d} ${t}` : d;
      } else {
        dtStr = String(row[mapping.datetime] ?? "").trim();
        if (!dtStr) { skips.push({ row: idx + 1, reason: "missing datetime" }); return; }
      }
      const parsed = new Date(dtStr);
      if (isNaN(parsed.getTime())) { skips.push({ row: idx + 1, reason: `unparseable date "${dtStr}"` }); return; }

      let direction = "unknown";
      if (directionMode === "explicit" && mapping.direction) {
        const cell = String(row[mapping.direction] ?? "").trim().toLowerCase();
        if (inValues.map((v) => v.toLowerCase()).includes(cell)) direction = "in";
        else if (outValues.map((v) => v.toLowerCase()).includes(cell)) direction = "out";
      }

      out.push({
        raw_device_id: rawId,
        punch_at: parsed.toISOString(),
        direction,
        raw_row: row,
        employee_id: biometricMap.get(rawId) ?? null,
      });
    });
    return { punches: out, skipped: skips };
  }, [dataRows, mapping, hasSeparateDateTime, directionMode, inValues, outValues, biometricMap]);

  const matchedCount = punches.filter((p) => p.employee_id).length;
  const unmatchedIds = useMemo(
    () => Array.from(new Set(punches.filter((p) => !p.employee_id).map((p) => p.raw_device_id))),
    [punches],
  );

  // Derive default period from punch range
  const derivedPeriod = useMemo(() => {
    if (!punches.length) return { start: "", end: "" };
    const dates = punches.map((p) => p.punch_at.slice(0, 10)).sort();
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [punches]);

  const effStart = periodStart || derivedPeriod.start;
  const effEnd = periodEnd || derivedPeriod.end;

  // ---- Commit ------------------------------------------------------------
  const handleImport = async () => {
    if (!punches.length) { toast.error("No valid punches to import"); return; }

    let savedProfileId: string | undefined = profileId !== NONE ? profileId : undefined;
    if (saveAsNew) {
      if (!newProfileName.trim()) { toast.error("Enter a name for the new device profile"); return; }
      const saved = await saveProfile.mutateAsync({
        name: newProfileName.trim(),
        file_format: fileName.toLowerCase().endsWith(".csv") ? "csv" : "xlsx",
        column_mapping: mapping,
        has_separate_date_time: hasSeparateDateTime,
        direction_mode: directionMode,
        in_values: inValues,
        out_values: outValues,
      });
      savedProfileId = saved?.id;
    }

    const batch = await importPunches.mutateAsync({
      fileName, deviceProfileId: savedProfileId,
      periodStart: effStart || undefined, periodEnd: effEnd || undefined,
      rows: punches,
    });
    setCommittedBatchId(batch.id);
  };

  const columnSelect = (value: string, onChange: (v: string) => void, allowNone = false) => (
    <Select value={value || (allowNone ? NONE : "")} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger><SelectValue placeholder="Select column" /></SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>— none —</SelectItem>}
        {detectedColumns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Import Attendance</h1>
          <p className="page-description">Upload a biometric device export, map its columns, and match punches to employees.</p>
        </div>
      </div>

      {/* Step 1 — Upload */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Upload className="w-4 h-4" />1. Upload file</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          {fileName && <p className="text-sm text-muted-foreground">{fileName} — {dataRows.length} rows, {detectedColumns.length} columns detected.</p>}
        </CardContent>
      </Card>

      {detectedColumns.length > 0 && (
        <>
          {/* Step 2 — Profile + Mapping */}
          <Card>
            <CardHeader><CardTitle className="text-base">2. Device profile & column mapping</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Saved profile</Label>
                  <Select value={profileId} onValueChange={applyProfile}>
                    <SelectTrigger><SelectValue placeholder="None — map manually" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None — map manually</SelectItem>
                      {profiles?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><Label>Device ID column *</Label>{columnSelect(mapping.device_id, (v) => setMapping((m) => ({ ...m, device_id: v })))}</div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={hasSeparateDateTime} onChange={(e) => setHasSeparateDateTime(e.target.checked)} />
                    Date &amp; time are in separate columns
                  </label>
                </div>
                {hasSeparateDateTime ? (
                  <>
                    <div><Label>Date column *</Label>{columnSelect(mapping.date, (v) => setMapping((m) => ({ ...m, date: v })))}</div>
                    <div><Label>Time column</Label>{columnSelect(mapping.time, (v) => setMapping((m) => ({ ...m, time: v })), true)}</div>
                  </>
                ) : (
                  <div><Label>Combined DateTime column *</Label>{columnSelect(mapping.datetime, (v) => setMapping((m) => ({ ...m, datetime: v })))}</div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Direction mode</Label>
                  <Select value={directionMode} onValueChange={(v) => setDirectionMode(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inferred">Inferred (alternating in/out)</SelectItem>
                      <SelectItem value="explicit">Explicit (read a direction column)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {directionMode === "explicit" && (
                  <div><Label>Direction column</Label>{columnSelect(mapping.direction, (v) => setMapping((m) => ({ ...m, direction: v })), true)}</div>
                )}
              </div>

              <div className="flex items-center gap-4 pt-2 border-t">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={saveAsNew} onChange={(e) => setSaveAsNew(e.target.checked)} />
                  Save this mapping as a new profile
                </label>
                {saveAsNew && <Input className="max-w-xs" placeholder="Profile name (e.g. ZKTeco K40)" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} />}
              </div>
            </CardContent>
          </Card>

          {/* Step 3 — Review */}
          {mapping.device_id && (hasSeparateDateTime ? mapping.date : mapping.datetime) && (
            <Card>
              <CardHeader><CardTitle className="text-base">3. Review &amp; import</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{punches.length} valid punches</Badge>
                  <Badge className="bg-green-600">{matchedCount} matched</Badge>
                  <Badge variant="destructive">{punches.length - matchedCount} unmatched</Badge>
                  {skipped.length > 0 && <Badge variant="outline" className="text-amber-600 border-amber-600"><AlertTriangle className="w-3 h-3 mr-1" />{skipped.length} skipped</Badge>}
                </div>

                <div className="grid grid-cols-2 gap-4 max-w-md">
                  <div><Label>Period start</Label><Input type="date" value={effStart} onChange={(e) => setPeriodStart(e.target.value)} /></div>
                  <div><Label>Period end</Label><Input type="date" value={effEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></div>
                </div>

                {unmatchedIds.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm">
                    <p className="font-medium text-amber-800 dark:text-amber-300">Unmatched device IDs (set <code>biometric_id</code> on these employees):</p>
                    <p className="text-amber-700 dark:text-amber-400 mt-1 break-words">{unmatchedIds.join(", ")}</p>
                  </div>
                )}

                {skipped.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">{skipped.length} rows skipped (click to view)</summary>
                    <ul className="mt-2 max-h-40 overflow-auto list-disc pl-6 text-muted-foreground">
                      {skipped.slice(0, 100).map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}
                    </ul>
                  </details>
                )}

                {/* Preview */}
                <div className="rounded-md border overflow-auto max-h-72">
                  <table className="data-table text-xs">
                    <thead><tr><th>Device ID</th><th>Punch At</th><th>Direction</th><th>Employee</th></tr></thead>
                    <tbody>
                      {punches.slice(0, 10).map((p, i) => (
                        <tr key={i}>
                          <td>{p.raw_device_id}</td>
                          <td>{new Date(p.punch_at).toLocaleString()}</td>
                          <td>{p.direction}</td>
                          <td>{p.employee_id
                            ? <span className="text-green-600">matched</span>
                            : <span className="text-destructive">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {!committedBatchId ? (
                  <div className="flex justify-end">
                    <Button onClick={handleImport} disabled={importPunches.isPending || saveProfile.isPending || !punches.length}>
                      {importPunches.isPending ? "Importing..." : `Import ${punches.length} punches`}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between rounded-md border border-green-300 bg-green-50 dark:bg-green-950/20 p-3">
                    <span className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                      <CheckCircle2 className="w-4 h-4" /> Batch imported. Run aggregation to build daily attendance.
                    </span>
                    <Button onClick={() => aggregate.mutate(committedBatchId)} disabled={aggregate.isPending}>
                      {aggregate.isPending ? "Aggregating..." : "Run aggregation"}
                    </Button>
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
