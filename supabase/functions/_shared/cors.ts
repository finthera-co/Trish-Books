export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  // Required: without this the browser blocks the frontend from reading the
  // rate-limit headers, which makes the client-side 429 handling dead code.
  "Access-Control-Expose-Headers":
    "x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, retry-after",
};

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}
