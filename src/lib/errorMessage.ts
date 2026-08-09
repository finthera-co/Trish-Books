/**
 * Turn anything thrown into text worth showing a user.
 *
 * The catch blocks around Supabase calls used to read
 * `e instanceof Error ? e.message : "…failed"`, which silently discards the
 * one case that actually happens: supabase-js rejects with a PostgrestError,
 * a plain object shaped `{ message, details, hint, code }` that is NOT an
 * Error instance. Every real database failure — a statement timeout, a missing
 * function, an RLS denial — therefore surfaced as a bare "failed" with the
 * diagnosis thrown away.
 */

interface PostgrestLike {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** Human-readable text for a handful of Postgres/PostgREST codes users can act on. */
function explainCode(code: string): string | null {
  switch (code) {
    case "57014":
      return "The database timed out building this report. Try a shorter date range.";
    case "53200":
    case "53100":
      return "The database ran out of resources for this report. Try a shorter date range.";
    case "PGRST202":
      return "The report function is missing from the database — this environment may be behind on migrations.";
    case "42501":
      return "You don't have permission to read part of this report.";
    default:
      return null;
  }
}

export function describeError(e: unknown, fallback = "Something went wrong"): string {
  if (typeof e === "string" && e.trim() !== "") return e.trim();

  if (e instanceof Error && str(e.message)) return e.message;

  if (e && typeof e === "object") {
    const p = e as PostgrestLike;
    const code = str(p.code);
    const parts = [str(p.message), str(p.details), str(p.hint)].filter(Boolean) as string[];
    const explained = code ? explainCode(code) : null;

    if (explained) return parts.length ? `${explained} (${parts[0]})` : explained;
    if (parts.length) return code ? `${parts.join(" — ")} [${code}]` : parts.join(" — ");
    if (code) return `${fallback} [${code}]`;
  }

  return fallback;
}

/**
 * Same, prefixed with the step that failed. A report export makes several
 * round trips; "failed" without saying which one leaves nothing to act on.
 */
export function describeStepError(step: string, e: unknown, fallback = "Something went wrong"): string {
  return `${step}: ${describeError(e, fallback)}`;
}
