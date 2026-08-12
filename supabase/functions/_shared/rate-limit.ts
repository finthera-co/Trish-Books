import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

export type RateLimitScope = "user" | "tenant" | "ip";

export interface RateLimitRule {
  scope: RateLimitScope;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitContext {
  userId?: string | null;    // public.users.id (NOT auth.users.id)
  tenantId?: string | null;
  ip?: string | null;
}

/**
 * Route policy table.
 * Tiering rationale:
 *   - AI / LLM routes are the most expensive per call → tightest limits.
 *   - Provisioning routes are signup-abuse surfaces → IP-scoped.
 *   - Bulk export is a data-exfiltration surface → very tight, tenant-scoped.
 *   - Posting routes are legitimate high-frequency operations → generous but bounded.
 */
export const RATE_LIMITS: Record<string, RateLimitRule[]> = {
  // Tier 1 — expensive / abusable
  "forecast-insights":     [{ scope: "user", limit: 10,  windowSeconds: 60 },
                            { scope: "tenant", limit: 60,  windowSeconds: 3600 }],
  "generate-insights":     [{ scope: "user", limit: 10,  windowSeconds: 60 },
                            { scope: "tenant", limit: 60,  windowSeconds: 3600 }],
  "detect-anomalies":      [{ scope: "user", limit: 10,  windowSeconds: 60 },
                            { scope: "tenant", limit: 60,  windowSeconds: 3600 }],
  "provision-tenant":      [{ scope: "ip",   limit: 5,   windowSeconds: 3600 }],
  "provision-google-user": [{ scope: "ip",   limit: 10,  windowSeconds: 3600 }],
  "weekly-csv-export":     [{ scope: "tenant", limit: 5, windowSeconds: 3600 }],

  // Tier 1 (cont.) — LLM / embedding routes. financial-analyst runs a multi-round
  // tool loop, so ONE request can mean many model calls: it is the most expensive
  // route on the platform and gets the tightest user limit of anything here.
  "financial-analyst":     [{ scope: "user", limit: 5,  windowSeconds: 60 },
                            { scope: "tenant", limit: 100, windowSeconds: 3600 }],
  "analyst-reindex":       [{ scope: "tenant", limit: 5, windowSeconds: 3600 }],

  // Deployed with verify_jwt=false. The handler checks is_super_admin() itself,
  // so this is not an authz hole — but unauthenticated callers still reach it and
  // cost a DB round trip each, so it is IP-limited as an amplification guard.
  "review-signup-request": [{ scope: "ip",   limit: 20, windowSeconds: 3600 }],

  // Outbound email — spam / reputation surface.
  "send-invoice-email":    [{ scope: "tenant", limit: 100, windowSeconds: 3600 }],

  // Tier 2 — compute heavy
  "reconcile-engine":      [{ scope: "tenant", limit: 30, windowSeconds: 60 }],
  "match-transactions":    [{ scope: "tenant", limit: 30, windowSeconds: 60 }],
  "import-bank-statement": [{ scope: "user", limit: 20, windowSeconds: 60 }],
  "forecast-backtest":     [{ scope: "user", limit: 20, windowSeconds: 60 }],
  "forecast-cashflow":     [{ scope: "user", limit: 20, windowSeconds: 60 }],
  "forecast-validation":   [{ scope: "user", limit: 20, windowSeconds: 60 }],
  "simulate-payroll":      [{ scope: "user", limit: 20, windowSeconds: 60 }],
  "simulate-scenario":     [{ scope: "user", limit: 20, windowSeconds: 60 }],

  // User administration — privesc-adjacent surfaces, kept deliberately modest.
  "create-user":           [{ scope: "user", limit: 20, windowSeconds: 60 }],
  "update-user":           [{ scope: "user", limit: 20, windowSeconds: 60 }],
  "provision-employee":    [{ scope: "user", limit: 20, windowSeconds: 60 }],
  "seed-chart-of-accounts":[{ scope: "tenant", limit: 10, windowSeconds: 3600 }],

  // Tier 3 — write path (generous; guards runaway loops, not humans)
  "post-invoice":            [{ scope: "user", limit: 120, windowSeconds: 60 }],
  "post-asset-transaction":  [{ scope: "user", limit: 120, windowSeconds: 60 }],
  "post-payroll-gl":         [{ scope: "user", limit: 60,  windowSeconds: 60 }],
  "post-credit-note":        [{ scope: "user", limit: 120, windowSeconds: 60 }],
  "post-payment-received":   [{ scope: "user", limit: 120, windowSeconds: 60 }],
  "ar-write-off":            [{ scope: "user", limit: 120, windowSeconds: 60 }],
  "validate-journal-entry":  [{ scope: "user", limit: 240, windowSeconds: 60 }],
  "resolve-posting-profile": [{ scope: "user", limit: 240, windowSeconds: 60 }],

  // Deliberately ABSENT (must stay unlimited):
  //   generate-recurring-invoices, invoice-due-reminders, storage-quota-reconcile
  //     — pg_cron invoked; a 429 would silently skip a scheduled run.
  //   resend-webhook — inbound from Resend, signature-verified, not caller-controlled.
};

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

interface Verdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset_at: string;
  retry_after: number;
}

/**
 * Returns a 429 Response if any rule is exceeded, otherwise returns headers to
 * merge into the successful response.
 *
 * FAIL-OPEN on infrastructure error: if the RPC itself fails we log and allow.
 * A rate limiter that takes the platform down when the counter table is
 * unreachable is worse than no rate limiter.
 */
export async function enforceRateLimit(
  admin: SupabaseClient,
  route: string,
  ctx: RateLimitContext,
): Promise<{ blocked: Response | null; headers: Record<string, string> }> {
  const rules = RATE_LIMITS[route];
  if (!rules?.length) return { blocked: null, headers: {} };

  let tightest: Verdict | null = null;

  for (const rule of rules) {
    const identifier =
      rule.scope === "user"   ? ctx.userId
    : rule.scope === "tenant" ? ctx.tenantId
    :                           ctx.ip;

    if (!identifier) continue; // scope not resolvable for this request

    const { data, error } = await admin.rpc("consume_rate_limit", {
      p_scope:          rule.scope,
      p_identifier:     identifier,
      p_route:          route,
      p_limit:          rule.limit,
      p_window_seconds: rule.windowSeconds,
      p_tenant_id:      ctx.tenantId ?? null,
      p_user_id:        ctx.userId ?? null,
    });

    if (error) {
      console.error(`[rate-limit] RPC failed for ${route}/${rule.scope}:`, error.message);
      continue; // fail open
    }

    const v = data as unknown as Verdict;
    if (!tightest || v.remaining < tightest.remaining) tightest = v;
    if (!v.allowed) {
      const headers = rateLimitHeaders(v);
      return {
        blocked: new Response(
          JSON.stringify({
            ok: false,
            error: "Rate limit exceeded. Please slow down and try again shortly.",
            code: "RATE_LIMITED",
            retry_after: v.retry_after,
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json", ...headers },
          },
        ),
        headers,
      };
    }
  }

  return { blocked: null, headers: tightest ? rateLimitHeaders(tightest) : {} };
}

function rateLimitHeaders(v: Verdict): Record<string, string> {
  return {
    "X-RateLimit-Limit":     String(v.limit),
    "X-RateLimit-Remaining": String(v.remaining),
    "X-RateLimit-Reset":     v.reset_at,
    "Retry-After":           String(v.retry_after),
  };
}
