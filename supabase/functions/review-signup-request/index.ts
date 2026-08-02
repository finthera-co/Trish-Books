// Review a signup application: approve it (provisioning the tenant and sending the
// applicant their access) or reject it.
//
// Everything that matters happens here rather than in the browser:
//   · the caller is checked against is_super_admin() before anything else,
//   · the initial password is generated server-side and is never returned to the
//     client or stored — the applicant sets their own from an emailed link,
//   · the request row is only marked approved after provisioning actually succeeded.
//
// Provisioning itself is delegated to the existing provision-tenant function rather
// than duplicated, so tenant creation, the Company Admin row and the chart-of-
// accounts seed stay in one place.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** A password nobody needs to know: the applicant replaces it via the emailed link. */
function generateSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") + "aA1!";
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: isSA } = await callerClient.rpc("is_super_admin");
    if (!isSA) throw new Error("Unauthorized: Super Admin only");

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { request_id, action, note, site_url } = await req.json();
    if (!request_id || !["approve", "reject"].includes(action)) {
      throw new Error("request_id and action ('approve' | 'reject') are required");
    }

    // Resolve the reviewer's users.id. auth.uid() is the auth user id, which is a
    // different key — writing it into reviewed_by would violate the FK.
    const { data: authUser } = await callerClient.auth.getUser();
    const { data: reviewer } = await adminClient
      .from("users")
      .select("id")
      .eq("auth_user_id", authUser?.user?.id)
      .maybeSingle();

    const { data: reqRow, error: reqErr } = await adminClient
      .from("signup_requests")
      .select("*")
      .eq("id", request_id)
      .maybeSingle();

    if (reqErr) throw new Error(reqErr.message);
    if (!reqRow) throw new Error("Signup request not found");
    if (reqRow.status !== "pending") {
      // Guards against two admins acting on the same row, and against a double
      // click provisioning a second tenant for one application.
      throw new Error(`This request has already been ${reqRow.status}`);
    }

    // ── Reject ───────────────────────────────────────────────────────────────
    if (action === "reject") {
      const { error } = await adminClient
        .from("signup_requests")
        .update({
          status: "rejected",
          review_note: note ?? null,
          reviewed_by: reviewer?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", request_id)
        .eq("status", "pending");
      if (error) throw new Error(error.message);
      return json({ ok: true, status: "rejected" });
    }

    // ── Approve ──────────────────────────────────────────────────────────────
    const provisionRes = await fetch(`${supabaseUrl}/functions/v1/provision-tenant`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        company_name: reqRow.company_name,
        country: reqRow.country ?? "Sri Lanka",
        industry: reqRow.industry ?? null,
        admin_email: reqRow.email,
        admin_password: generateSecret(),
        admin_first_name: reqRow.first_name,
        admin_last_name: reqRow.last_name,
      }),
    });

    const provision = await provisionRes.json().catch(() => ({}));
    if (!provisionRes.ok || provision?.error) {
      throw new Error(`Provisioning failed: ${provision?.error ?? provisionRes.status}`);
    }

    // Only now is the application closed — if provisioning had failed above, the
    // request stays pending and can be retried.
    const { error: updErr } = await adminClient
      .from("signup_requests")
      .update({
        status: "approved",
        tenant_id: provision?.tenant?.id ?? null,
        review_note: note ?? null,
        reviewed_by: reviewer?.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", request_id)
      .eq("status", "pending");
    if (updErr) throw new Error(updErr.message);

    // ── Send the applicant their access ──────────────────────────────────────
    // A set-password link rather than a password in the body of an email: mail is
    // not a confidential channel and it is retained indefinitely. The applicant's
    // username is their email; the link lets them choose the secret.
    const site = (site_url as string) ?? Deno.env.get("SITE_URL") ?? "";
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: reqRow.email,
      options: site ? { redirectTo: `${site}/reset-password` } : undefined,
    });

    const actionLink = linkData?.properties?.action_link;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("INVOICE_FROM_EMAIL");

    let emailed = false;
    let emailError: string | null = null;

    if (linkErr) {
      emailError = `Could not generate access link: ${linkErr.message}`;
    } else if (!resendKey || !fromEmail) {
      emailError = "RESEND_API_KEY / INVOICE_FROM_EMAIL not configured — send the link manually";
    } else {
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;color:#001D39">
          <h2 style="font-size:20px;margin:0 0 12px">Your Finthera account is ready</h2>
          <p style="margin:0 0 16px;line-height:1.6">
            Hello ${escapeHtml(reqRow.first_name)}, your application for
            <strong>${escapeHtml(reqRow.company_name)}</strong> has been approved.
          </p>
          <p style="margin:0 0 8px;line-height:1.6">Sign in with this email address:</p>
          <p style="margin:0 0 20px"><strong>${escapeHtml(reqRow.email)}</strong></p>
          <p style="margin:0 0 20px;line-height:1.6">
            Set your password using the link below, then sign in.
          </p>
          <p style="margin:0 0 24px">
            <a href="${actionLink}" style="display:inline-block;background:#0A4174;color:#fff;
               text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600">
              Set your password
            </a>
          </p>
          <p style="margin:0;font-size:12px;color:#5B7189;line-height:1.6">
            This link can be used once and expires. If it has expired, use
            “Forgot password” on the sign-in page to request a new one.
          </p>
        </div>`;

      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `Finthera <${fromEmail}>`,
          to: [reqRow.email],
          subject: "Your Finthera account is ready",
          html,
        }),
      });
      if (resp.ok) emailed = true;
      else emailError = `Resend: ${await resp.text()}`;
    }

    // The account exists either way — report the email outcome so the reviewer
    // knows whether they still have to pass the link on by hand.
    return json({
      ok: true,
      status: "approved",
      tenant_id: provision?.tenant?.id ?? null,
      emailed,
      email_error: emailError,
      action_link: emailed ? null : actionLink ?? null,
    });
  } catch (error) {
    return json({ ok: false, error: (error as Error).message }, 400);
  }
});
