// Fuzzy header → field detection + punch-building logic for attendance imports.

export type DirectionMode = "explicit" | "inferred";

// Day/Month/Year component order of the raw date strings. Biometric exports carry
// no timezone or locale, so the order is ambiguous (06/07 = 7 Jun or 6 Jul?) and
// MUST be declared explicitly — guessing silently mis-dates hours. DMY is the
// Sri Lankan default.
export type DateOrder = "DMY" | "MDY" | "YMD";

// Local timezone the devices stamp in. Punches carry no offset, so we anchor them
// to Asia/Colombo (+05:30) when building the timestamp, independent of the
// importer's browser timezone. Must match the AT TIME ZONE used by the
// aggregation RPC, or worked hours land on the wrong day.
export const DEVICE_TZ_OFFSET = "+05:30";

export interface ColumnMapping {
  device_id: string | null;
  date: string | null;
  time: string | null;       // only used when has_separate_date_time
  datetime: string | null;   // only used when NOT has_separate_date_time
  direction: string | null;
}

export interface MappingConfig {
  mapping: ColumnMapping;
  has_separate_date_time: boolean;
  direction_mode: DirectionMode;
  in_values: string[];
  out_values: string[];
  debounce_seconds: number;
  date_order: DateOrder;
}

export const DEFAULT_IN_VALUES = ["in", "i", "0", "checkin", "check-in", "c/in", "duty on", "on"];
export const DEFAULT_OUT_VALUES = ["out", "o", "1", "checkout", "check-out", "c/out", "duty off", "off"];

// Candidate header tokens per field, lowercased, matched by substring.
const HINTS: Record<keyof ColumnMapping, string[]> = {
  device_id: ["ac-no", "ac no", "acno", "user id", "userid", "user", "enno", "en-no", "emp id", "empid",
              "employee id", "badge", "pin", "person id", "no.", "uid", "device id", "id"],
  date:      ["date", "att date", "work date", "day"],
  time:      ["time", "punch time", "clock", "att time"],
  datetime:  ["datetime", "date time", "date/time", "timestamp", "date_time", "punch", "log time", "scan time"],
  direction: ["state", "status", "in/out", "inout", "direction", "type", "mode", "c/in", "verify type", "attstate"],
};

function bestMatch(headers: string[], field: keyof ColumnMapping): string | null {
  const lower = headers.map((h) => ({ raw: h, l: h.trim().toLowerCase() }));
  // 1. exact token match
  for (const hint of HINTS[field]) {
    const exact = lower.find((h) => h.l === hint);
    if (exact) return exact.raw;
  }
  // 2. substring match (longest hint first so "user id" beats "id")
  const ordered = [...HINTS[field]].sort((a, b) => b.length - a.length);
  for (const hint of ordered) {
    const hit = lower.find((h) => h.l.includes(hint));
    if (hit) return hit.raw;
  }
  return null;
}

// Detect whether the file looks like it has a combined datetime vs separate columns.
export function autoDetect(headers: string[]): MappingConfig {
  const datetime = bestMatch(headers, "datetime");
  const date = bestMatch(headers, "date");
  const time = bestMatch(headers, "time");
  // separate columns win only if BOTH date and time exist and there's no single datetime column
  const hasSeparate = !!date && !!time && !datetime;
  const direction = bestMatch(headers, "direction");
  return {
    mapping: {
      device_id: bestMatch(headers, "device_id"),
      date: hasSeparate ? date : (datetime ?? date),
      time: hasSeparate ? time : null,
      datetime: hasSeparate ? null : (datetime ?? date),
      direction,
    },
    has_separate_date_time: hasSeparate,
    direction_mode: direction ? "explicit" : "inferred",
    in_values: DEFAULT_IN_VALUES,
    out_values: DEFAULT_OUT_VALUES,
    debounce_seconds: 60,
    date_order: "DMY",
  };
}

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

// Split a date string into Y/M/D using a declared component order. Deterministic —
// never relies on the JS engine's locale guessing (which silently parses dd/mm as
// mm/dd). Accepts / - . separators and 2- or 4-digit years.
export function parseDateParts(dateStr: string, order: DateOrder): { y: number; m: number; d: number } | null {
  const parts = dateStr.trim().split(/[/\-.]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const n = parts.slice(0, 3).map((p) => Number(p));
  if (n.some((x) => !Number.isFinite(x))) return null;
  let y: number, m: number, d: number;
  if (order === "YMD") [y, m, d] = n;
  else if (order === "MDY") [m, d, y] = n;
  else [d, m, y] = n; // DMY
  if (y < 100) y += 2000; // 2-digit year → 20xx
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

// Parse a clock time, honouring 12-hour AM/PM suffixes. Defaults to 00:00:00.
function parseTimeParts(timeStr: string): { h: number; mi: number; s: number } {
  const t = (timeStr || "").trim();
  if (!t) return { h: 0, mi: 0, s: 0 };
  const ampm = /\b(am|pm)\b/i.exec(t);
  const nums = t.replace(/\b(am|pm)\b/i, "").trim().split(":").map((s) => parseInt(s, 10));
  let h = Number.isFinite(nums[0]) ? nums[0] : 0;
  const mi = Number.isFinite(nums[1]) ? nums[1] : 0;
  const s = Number.isFinite(nums[2]) ? nums[2] : 0;
  if (ampm) {
    const pm = ampm[1].toLowerCase() === "pm";
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  return { h, mi, s };
}

// Build a UTC ISO timestamp from a row. The raw date is read in the configured
// DMY/MDY/YMD order and anchored to the device timezone (Asia/Colombo) so the
// result is correct regardless of where the import runs. Returns null if unparseable.
export function parsePunchAt(row: Record<string, any>, cfg: MappingConfig): string | null {
  const m = cfg.mapping;
  let dateStr: string;
  let timeStr: string;
  if (cfg.has_separate_date_time) {
    if (!m.date || !m.time) return null;
    dateStr = (row[m.date] ?? "").toString().trim();
    timeStr = (row[m.time] ?? "").toString().trim();
  } else {
    if (!m.datetime) return null;
    const raw = (row[m.datetime] ?? "").toString().trim();
    if (!raw) return null;
    // A fully-qualified ISO timestamp (carries its own offset / Z) is unambiguous —
    // honour it directly rather than re-anchoring.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
      const iso = new Date(raw);
      return isNaN(iso.getTime()) ? null : iso.toISOString();
    }
    // Otherwise split the first date token from the rest (time): handles "T" and space separators.
    const sepIdx = raw.indexOf("T") >= 0 ? raw.indexOf("T") : raw.indexOf(" ");
    if (sepIdx === -1) { dateStr = raw; timeStr = ""; }
    else { dateStr = raw.slice(0, sepIdx).trim(); timeStr = raw.slice(sepIdx + 1).trim(); }
  }
  if (!dateStr) return null;
  const dp = parseDateParts(dateStr, cfg.date_order);
  if (!dp) return null;
  const tp = parseTimeParts(timeStr);
  // Anchor to the device timezone, then normalise to UTC. No browser-TZ dependence.
  const anchored = new Date(
    `${pad(dp.y, 4)}-${pad(dp.m)}-${pad(dp.d)}T${pad(tp.h)}:${pad(tp.mi)}:${pad(tp.s)}${DEVICE_TZ_OFFSET}`,
  );
  if (isNaN(anchored.getTime())) return null;
  return anchored.toISOString();
}

export type ResolvedDirection = "in" | "out" | "unknown";

export function resolveDirection(
  row: Record<string, any>,
  cfg: MappingConfig,
  alternateState: { next: ResolvedDirection },
): ResolvedDirection {
  if (cfg.direction_mode === "inferred" || !cfg.mapping.direction) {
    const d = alternateState.next;
    alternateState.next = d === "in" ? "out" : "in";
    return d;
  }
  const v = (row[cfg.mapping.direction] ?? "").toString().trim().toLowerCase();
  if (cfg.in_values.includes(v)) return "in";
  if (cfg.out_values.includes(v)) return "out";
  return "unknown";
}

// Collapse scans from the same device within debounce_seconds into one punch (keep earliest).
export function debouncePunches<T extends { raw_device_id: string; punch_at: string }>(
  punches: T[],
  debounceSeconds: number,
): { kept: T[]; collapsed: number } {
  if (debounceSeconds <= 0) return { kept: punches, collapsed: 0 };
  const byDevice: Record<string, T[]> = {};
  punches.forEach((p) => (byDevice[p.raw_device_id] ??= []).push(p));
  const kept: T[] = [];
  let collapsed = 0;
  Object.values(byDevice).forEach((list) => {
    list.sort((a, b) => a.punch_at.localeCompare(b.punch_at));
    let lastKept: number | null = null;
    list.forEach((p) => {
      const t = new Date(p.punch_at).getTime();
      if (lastKept !== null && (t - lastKept) / 1000 < debounceSeconds) {
        collapsed++;
        return;
      }
      kept.push(p);
      lastKept = t;
    });
  });
  kept.sort((a, b) => a.punch_at.localeCompare(b.punch_at));
  return { kept, collapsed };
}

// ===== Payroll: turn aggregated attendance into earned pay per pay-rate type =====

export interface PayComputeInput {
  payRateType: "monthly" | "hourly" | string;
  contractualBasic: number;   // employees.salary (synced from current compensation)
  hourlyRate: number;         // employees.pay_rate
  workedHours: number;
  otHours: number;
  absentDays: number;
  halfDays: number;
  nonEmployedDays?: number;   // working days outside employment (mid-period joiner/leaver) — unpaid
  undertimeMinutes?: number;  // late minutes; converted to a fractional unpaid day when the policy is on
  workingDays: number;        // denominator for salaried pro-rata
  otMultiplier?: number;      // normal OT rate, from the shift (default 1.5)
  stdHoursPerDay?: number;    // standard hours/day, from the shift (default 8)
  holidayOtHours?: number;    // rest-day / holiday hours worked
  holidayOtMultiplier?: number; // rest-day / holiday OT rate (default 2.0)
  otIncludesAllowances?: boolean; // base monthly OT on basic + allowances
  otBaseAllowances?: number;      // EPF-able allowances to fold into the OT base
}

export interface PayComputeResult {
  basic_salary: number;       // EARNED basic (pro-rated / hours-based) — engine computes EPF/ETF on this
  overtime_hours: number;
  overtime_pay: number;
  hours_worked: number;
}

export function computePayFromAttendance(i: PayComputeInput): PayComputeResult {
  const otMult = i.otMultiplier ?? 1.5;
  const holMult = i.holidayOtMultiplier ?? 2.0;
  const holOtHours = i.holidayOtHours ?? 0;
  const stdHoursPerDay = i.stdHoursPerDay && i.stdHoursPerDay > 0 ? i.stdHoursPerDay : 8;
  const totalOtHours = i.otHours + holOtHours;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  if (i.payRateType === "hourly") {
    // Base pay covers ONLY normal hours at 1×; OT and rest-day/holiday hours are
    // paid through otPay at their multiplier. (Previously basic paid every worked
    // hour at 1× and otPay added the full multiplier on top → OT earned ~2.5×.)
    const normalHours = Math.max(0, i.workedHours - i.otHours - holOtHours);
    const basic = i.hourlyRate * normalHours;
    const otPay = i.hourlyRate * (otMult * i.otHours + holMult * holOtHours);
    return {
      basic_salary: round2(basic),
      overtime_hours: round2(totalOtHours),
      overtime_pay: round2(otPay),
      hours_worked: round2(i.workedHours),
    };
  }

  // monthly: pro-rate basic for unpaid days (absence + half-day×0.5 + days outside
  // employment for a mid-period joiner/leaver + undertime), add OT on the daily rate.
  const undertimeDays = (i.undertimeMinutes ?? 0) / (60 * stdHoursPerDay);
  const lostDays = i.absentDays + i.halfDays * 0.5 + (i.nonEmployedDays ?? 0) + undertimeDays;
  const proRataFactor = Math.max(0, (i.workingDays - lostDays) / i.workingDays);
  const earnedBasic = i.contractualBasic * proRataFactor;

  // derive an hourly rate from monthly basic for OT: base / (workingDays × stdHoursPerDay).
  // The OT base is basic, optionally plus EPF-able allowances per shift policy.
  const otBase = i.contractualBasic + (i.otIncludesAllowances ? (i.otBaseAllowances ?? 0) : 0);
  const derivedHourly = otBase / (i.workingDays * stdHoursPerDay);
  const otPay = derivedHourly * (otMult * i.otHours + holMult * holOtHours);

  return {
    basic_salary: round2(earnedBasic),
    overtime_hours: round2(totalOtHours),
    overtime_pay: round2(otPay),
    hours_worked: round2(i.workedHours),
  };
}

// Returns the conflicting employee if this device ID is already taken by someone else.
// `employees` is the list from useEmployees(). `selfId` excludes the row being edited.
export function findBiometricConflict(
  employees: Array<{ id: string; biometric_id?: string | null; first_name?: string; last_name?: string; employee_number?: string }>,
  deviceId: string,
  selfId?: string,
): { id: string; name: string; employee_number?: string } | null {
  const target = (deviceId ?? "").trim();
  if (!target) return null;
  const hit = employees.find(
    (e) => e.id !== selfId && ((e.biometric_id ?? "").trim() === target),
  );
  if (!hit) return null;
  return {
    id: hit.id,
    name: `${hit.first_name ?? ""} ${hit.last_name ?? ""}`.trim() || "another employee",
    employee_number: hit.employee_number ?? undefined,
  };
}
