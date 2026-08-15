/**
 * Request-body validation for edge functions.
 *
 * Why this exists: every function here runs its privileged work through the
 * service_role client, which bypasses RLS entirely. That makes the request body
 * the *only* thing standing between a caller and a write — and until this module
 * the guards were all shaped like `if (!x) throw`, which is a truthiness test, not
 * a validation. `!amount` lets `Infinity`, `1e308` and `"12"` through; `!user_id`
 * lets `{}` and `["../"]` through, straight into `.eq()`.
 *
 * Deliberately hand-rolled rather than zod: the browser bundle already carries zod
 * (see src/lib/validation.ts, which mirrors these rules), but pulling a CDN import
 * into every cold start here costs more than the ~150 lines it would save.
 *
 * Shape of use — call sites keep their own error convention, because they are not
 * consistent with each other and changing them would break clients:
 *
 *   const v = validate(body, { customer_id: uuid(), amount: money() });
 *   if (!v.ok) return json({ ok: false, error: v.message }, 200);
 *   const { customer_id, amount } = v.value;
 */

export interface FieldError {
  field: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldError[]; message: string };

/**
 * A rule returns the coerced value, or throws with a reason. Rules coerce rather
 * than merely check so that call sites get a trimmed string / real number back and
 * cannot accidentally keep using the raw body value.
 */
export interface Rule<T> {
  optional?: boolean;
  parse: (raw: unknown) => T;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Deliberately loose. A strict RFC 5322 pattern rejects addresses that real mail
// servers accept, and the authority on deliverability is the mail provider, not us.
// This only rules out the shapes that are certainly not addresses.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Postgres `numeric(15,2)` tops out well below this; nothing legitimate approaches it. */
const MAX_MONEY = 1_000_000_000_000;

export function uuid(): Rule<string> {
  return {
    parse: (raw) => {
      if (typeof raw !== "string" || !UUID_RE.test(raw)) {
        throw new Error("must be a valid UUID");
      }
      return raw;
    },
  };
}

/**
 * A monetary amount. Rejects the values a `> 0` test silently accepts: NaN,
 * Infinity, and numeric strings that would reach Postgres as text.
 */
export function money(
  opts: { min?: number; max?: number; allowZero?: boolean } = {},
): Rule<number> {
  const min = opts.min ?? (opts.allowZero ? 0 : Number.MIN_VALUE);
  const max = opts.max ?? MAX_MONEY;
  return {
    parse: (raw) => {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) {
        throw new Error("must be a finite number");
      }
      if (n < min) throw new Error(opts.allowZero ? "cannot be negative" : "must be greater than zero");
      if (n > max) throw new Error(`must not exceed ${max}`);
      return n;
    },
  };
}

export function int(opts: { min?: number; max?: number } = {}): Rule<number> {
  const min = opts.min ?? Number.MIN_SAFE_INTEGER;
  const max = opts.max ?? Number.MAX_SAFE_INTEGER;
  return {
    parse: (raw) => {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isInteger(n)) {
        throw new Error("must be a whole number");
      }
      if (n < min || n > max) throw new Error(`must be between ${min} and ${max}`);
      return n;
    },
  };
}

/**
 * A bounded string. `max` is not optional on purpose — an unbounded text field
 * reaching a service_role insert is a storage-abuse surface, and every column
 * behind these functions has a real limit worth stating here.
 */
export function str(max: number, opts: { min?: number } = {}): Rule<string> {
  const min = opts.min ?? 1;
  return {
    parse: (raw) => {
      if (typeof raw !== "string") throw new Error("must be text");
      const s = raw.trim();
      if (s.length < min) throw new Error(min === 1 ? "is required" : `must be at least ${min} characters`);
      if (s.length > max) throw new Error(`must be ${max} characters or fewer`);
      return s;
    },
  };
}

export function email(): Rule<string> {
  return {
    parse: (raw) => {
      if (typeof raw !== "string") throw new Error("must be text");
      const s = raw.trim().toLowerCase();
      if (s.length > 320 || !EMAIL_RE.test(s)) throw new Error("must be a valid email address");
      return s;
    },
  };
}

/**
 * Auth passwords. The floor matches the Supabase project setting; without the
 * ceiling a multi-megabyte password reaches bcrypt and burns CPU per attempt.
 */
export function password(min = 8): Rule<string> {
  return {
    parse: (raw) => {
      if (typeof raw !== "string") throw new Error("must be text");
      if (raw.length < min) throw new Error(`must be at least ${min} characters`);
      if (raw.length > 200) throw new Error("must be 200 characters or fewer");
      return raw;
    },
  };
}

/** ISO calendar date. Checks the value is a real day, not just the right shape. */
export function isoDate(): Rule<string> {
  return {
    parse: (raw) => {
      if (typeof raw !== "string" || !DATE_RE.test(raw)) {
        throw new Error("must be a date in YYYY-MM-DD form");
      }
      const d = new Date(`${raw}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
        throw new Error("is not a real calendar date");
      }
      return raw;
    },
  };
}

/**
 * An absolute http(s) URL. Used for values that end up in an emailed link, where
 * an unchecked string is a phishing redirect wearing our domain's return address.
 * javascript:, data: and protocol-relative forms are all rejected by the scheme
 * test rather than by pattern-matching the string.
 */
export function httpUrl(): Rule<string> {
  return {
    parse: (raw) => {
      if (typeof raw !== "string" || raw.length > 2048) throw new Error("must be a URL");
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        throw new Error("must be an absolute URL");
      }
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        throw new Error("must be an http or https URL");
      }
      return u.origin + u.pathname.replace(/\/$/, "");
    },
  };
}

export function enumOf<const T extends readonly string[]>(values: T): Rule<T[number]> {
  return {
    parse: (raw) => {
      if (typeof raw !== "string" || !values.includes(raw)) {
        throw new Error(`must be one of: ${values.join(", ")}`);
      }
      return raw as T[number];
    },
  };
}

export function bool(): Rule<boolean> {
  return {
    parse: (raw) => {
      if (typeof raw === "boolean") return raw;
      if (raw === "true") return true;
      if (raw === "false") return false;
      throw new Error("must be true or false");
    },
  };
}

/** A bounded array. The cap is what stops one request from becoming a bulk job. */
export function arrayOf<T>(item: Rule<T>, max: number, opts: { min?: number } = {}): Rule<T[]> {
  const min = opts.min ?? 0;
  return {
    parse: (raw) => {
      if (!Array.isArray(raw)) throw new Error("must be a list");
      if (raw.length < min) throw new Error(`must have at least ${min} item(s)`);
      if (raw.length > max) throw new Error(`must have ${max} items or fewer`);
      return raw.map((el, i) => {
        try {
          return item.parse(el);
        } catch (e) {
          throw new Error(`item ${i + 1} ${(e as Error).message}`);
        }
      });
    },
  };
}

/**
 * Marks a rule as optional. Absent, null and "" all yield undefined rather than
 * running the rule, so `notes: optional(str(500))` does not reject a blank field.
 */
export function optional<T>(rule: Rule<T>): Rule<T | undefined> {
  return {
    optional: true,
    parse: (raw) => {
      if (raw === undefined || raw === null || raw === "") return undefined;
      return rule.parse(raw);
    },
  };
}

/** Optional with a stand-in when the caller omits the field. */
export function withDefault<T>(rule: Rule<T>, fallback: T | (() => T)): Rule<T> {
  return {
    optional: true,
    parse: (raw) => {
      if (raw === undefined || raw === null || raw === "") {
        return typeof fallback === "function" ? (fallback as () => T)() : fallback;
      }
      return rule.parse(raw);
    },
  };
}

export type Schema = Record<string, Rule<unknown>>;

export type Infer<S extends Schema> = { [K in keyof S]: S[K] extends Rule<infer T> ? T : never };

/**
 * Validates every field before returning, so a caller fixing a bad request sees
 * all of its problems at once instead of one per round trip.
 */
export function validate<S extends Schema>(body: unknown, schema: S): ValidationResult<Infer<S>> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      errors: [{ field: "_body", message: "must be a JSON object" }],
      message: "Request body must be a JSON object",
    };
  }

  const src = body as Record<string, unknown>;
  const value: Record<string, unknown> = {};
  const errors: FieldError[] = [];

  for (const [field, rule] of Object.entries(schema)) {
    const raw = src[field];
    if (raw === undefined && !rule.optional) {
      errors.push({ field, message: "is required" });
      continue;
    }
    try {
      const parsed = rule.parse(raw);
      if (parsed !== undefined) value[field] = parsed;
    } catch (e) {
      errors.push({ field, message: (e as Error).message });
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      message: errors.map((e) => `${e.field} ${e.message}`).join("; "),
    };
  }
  return { ok: true, value: value as Infer<S> };
}

/**
 * Reads and validates the body in one step. A malformed JSON payload is reported
 * as a validation failure rather than throwing, so it lands on the same 400 path
 * as a bad field instead of the catch-all 500.
 */
export async function validateBody<S extends Schema>(
  req: Request,
  schema: S,
): Promise<ValidationResult<Infer<S>>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return {
      ok: false,
      errors: [{ field: "_body", message: "is not valid JSON" }],
      message: "Request body is not valid JSON",
    };
  }
  return validate(body, schema);
}

/**
 * Resolves the caller behind a request, for handlers that run as service_role.
 *
 * Those handlers get no RLS and no auth.uid(), so `is_super_admin()` and
 * `get_user_tenant_id()` both come back empty and the caller is invisible unless
 * it is resolved by hand. Returns null when there is no valid session.
 */
export async function resolveCaller(
  admin: { auth: { getUser: (t: string) => Promise<any> }; from: (t: string) => any },
  req: Request,
): Promise<{ id: string; tenant_id: string | null; role_name: string | null } | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const { data: authData } = await admin.auth.getUser(token);
  if (!authData?.user) return null;

  const { data } = await admin
    .from("users")
    .select("id, tenant_id, roles(role_name)")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (!data) return null;

  return {
    id: data.id,
    tenant_id: data.tenant_id ?? null,
    role_name: (data.roles as { role_name?: string } | null)?.role_name ?? null,
  };
}

/**
 * Confirms a body-supplied tenant_id is the caller's own.
 *
 * The recurring shape this guards: a service_role handler resolves the caller
 * only to key the rate limiter, then runs every query against the tenant_id from
 * the request body. The limiter is keyed correctly and the data is not — so the
 * route reads and writes whatever company the caller names. Returns an error
 * string to report, or null when the request is legitimate.
 */
export function assertCallerTenant(
  caller: { tenant_id: string | null; role_name: string | null } | null,
  bodyTenantId: string,
): string | null {
  if (!caller) return "Unauthorized";
  if (!caller.tenant_id) return "No tenant context for this user";
  if (caller.tenant_id === bodyTenantId) return null;
  // Super Admins read across tenants everywhere else in the product; these
  // routes are not the place to make them an exception.
  if (caller.role_name === "Super Admin") return null;
  return "Cannot act on another company";
}

/**
 * Confirms a body-supplied account id belongs to the caller's tenant.
 *
 * Necessary because the posting functions look accounts up with the service_role
 * client, which does not apply the accounts RLS policy — so `.eq("id", accountId)`
 * alone will happily resolve another tenant's account and post a line against it.
 * The DB trigger added alongside this module is the backstop; this exists so the
 * caller gets a clear message instead of a raised exception.
 */
export async function assertTenantAccounts(
  db: { from: (t: string) => any },
  tenantId: string,
  accountIds: (string | null | undefined)[],
): Promise<string | null> {
  const ids = [...new Set(accountIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return null;

  const { data, error } = await db
    .from("accounts")
    .select("id, is_active")
    .eq("tenant_id", tenantId)
    .in("id", ids);

  if (error) return `Could not verify accounts: ${error.message}`;

  const found = new Map<string, boolean>((data ?? []).map((a: any) => [a.id, a.is_active]));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    // Same message whether the account is absent or simply another tenant's — the
    // difference is not the caller's business and confirming it would leak that
    // the id exists somewhere.
    return `Account not found in this company: ${missing.join(", ")}`;
  }
  const inactive = ids.filter((id) => found.get(id) === false);
  if (inactive.length > 0) return `Account is inactive: ${inactive.join(", ")}`;

  return null;
}
