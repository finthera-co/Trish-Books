// Fuzzy header → field detection + punch-building logic for attendance imports.

export type DirectionMode = "explicit" | "inferred";

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
  };
}

// Build an ISO timestamp string from a row given the config. Returns null if unparseable.
export function parsePunchAt(row: Record<string, any>, cfg: MappingConfig): string | null {
  const m = cfg.mapping;
  let raw: string;
  if (cfg.has_separate_date_time) {
    if (!m.date || !m.time) return null;
    raw = `${(row[m.date] ?? "").toString().trim()} ${(row[m.time] ?? "").toString().trim()}`.trim();
  } else {
    if (!m.datetime) return null;
    raw = (row[m.datetime] ?? "").toString().trim();
  }
  if (!raw) return null;
  // Normalise common separators (dd/mm/yyyy and dd-mm-yyyy are ambiguous; see note below)
  const d = new Date(raw.replace(/\./g, "/"));
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
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
