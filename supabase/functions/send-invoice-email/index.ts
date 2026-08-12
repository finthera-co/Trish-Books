import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

interface SendBody {
  invoice_id: string;
  recipient: string;
  subject?: string;
  message?: string;       // plain-text body; converted to simple HTML
  pdf_base64?: string;    // raw base64 (no data: prefix) of the invoice PDF
  pdf_filename?: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Missing authorization" }, 200);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("INVOICE_FROM_EMAIL");

    if (!resendKey) return json({ ok: false, error: "RESEND_API_KEY is not configured" }, 200);
    if (!fromEmail) return json({ ok: false, error: "INVOICE_FROM_EMAIL is not configured" }, 200);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ ok: false, error: "Unauthorized" }, 200);

    const { data: appUser } = await admin
      .from("users")
      .select("id, tenant_id")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser?.tenant_id) return json({ ok: false, error: "User not in a tenant" }, 200);

    // Outbound email is a spam / sender-reputation surface, so this runs before
    // the invoice is loaded and before anything is handed to the mail provider.
    const { blocked, headers: rlHeaders } = await enforceRateLimit(
      admin,
      "send-invoice-email",
      { userId: appUser.id, tenantId: appUser.tenant_id, ip: clientIp(req) },
    );
    if (blocked) return blocked;

    const body = (await req.json()) as SendBody;
    const { invoice_id, recipient } = body;
    if (!invoice_id) return json({ ok: false, error: "invoice_id is required" }, 200);
    if (!recipient || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
      return json({ ok: false, error: "A valid recipient email is required" }, 200);
    }

    // The invoice must belong to the caller's tenant.
    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .select("id, invoice_number, tenant_id, total_amount")
      .eq("id", invoice_id)
      .eq("tenant_id", appUser.tenant_id)
      .single();
    if (invErr || !invoice) return json({ ok: false, error: "Invoice not found" }, 200);

    const { data: tenant } = await admin
      .from("tenants")
      .select("company_name")
      .eq("id", appUser.tenant_id)
      .single();
    const companyName = tenant?.company_name || "Trish Books";

    const subject = body.subject?.trim() || `Invoice ${invoice.invoice_number} from ${companyName}`;
    const messageText = body.message?.trim() || `Please find invoice ${invoice.invoice_number} attached.`;
    const html =
      `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1f2937;line-height:1.6">` +
      escapeHtml(messageText).replace(/\n/g, "<br/>") +
      `</div>`;

    // Include the invoice's uploaded attachments as links. The bucket is private,
    // so we mint fresh signed URLs here at send time (service role) with a long
    // validity so the recipient can still open them from their inbox for weeks.
    // Re-signing on every send means each email carries its own live links.
    const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
    let attachmentLinksHtml = "";
    const { data: atts } = await admin
      .from("invoice_attachments")
      .select("file_name, file_path")
      .eq("invoice_id", invoice_id)
      .eq("tenant_id", appUser.tenant_id);
    if (atts && atts.length) {
      const items: string[] = [];
      for (const a of atts) {
        const { data: signed } = await admin.storage
          .from("invoice-attachments")
          .createSignedUrl(a.file_path, SIGNED_URL_TTL_SECONDS);
        if (signed?.signedUrl) {
          items.push(
            `<li style="margin:2px 0"><a href="${signed.signedUrl}" style="color:#2563eb">${escapeHtml(a.file_name)}</a></li>`
          );
        }
      }
      if (items.length) {
        attachmentLinksHtml =
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1f2937;margin-top:16px">` +
          `<p style="font-weight:600;margin:0 0 4px">Attachments</p>` +
          `<ul style="margin:0;padding-left:18px">${items.join("")}</ul></div>`;
      }
    }

    // Log the attempt up front so a provider failure is still auditable.
    const { data: logRow } = await admin
      .from("invoice_emails")
      .insert({
        tenant_id: appUser.tenant_id,
        invoice_id,
        recipient,
        subject,
        status: "sending",
        sent_by: appUser.id,
      })
      .select("id")
      .single();
    const logId = logRow?.id;

    const attachments = body.pdf_base64
      ? [{ filename: body.pdf_filename || `Invoice-${invoice.invoice_number}.pdf`, content: body.pdf_base64 }]
      : [];

    // ── Send via Resend ──────────────────────────────────────────────
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${companyName} <${fromEmail}>`,
        to: [recipient],
        subject,
        html: html + attachmentLinksHtml,
        attachments,
      }),
    });

    const result = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const errMsg = result?.message || result?.error || `Resend error ${resp.status}`;
      if (logId) await admin.from("invoice_emails").update({ status: "failed", error: errMsg }).eq("id", logId);
      await admin.from("invoices").update({ email_status: "failed" }).eq("id", invoice_id);
      return json({ ok: false, error: errMsg }, 200);
    }

    const messageId = result?.id ?? null;
    if (logId) {
      await admin.from("invoice_emails")
        .update({ status: "sent", provider_message_id: messageId })
        .eq("id", logId);
    }
    await admin.from("invoices")
      .update({ email_status: "sent", email_recipient: recipient, last_emailed_at: new Date().toISOString() })
      .eq("id", invoice_id);

    await admin.from("audit_logs").insert({
      action: "Invoice Emailed",
      table_name: "invoices",
      record_id: invoice_id,
      user_id: appUser.id,
      tenant_id: appUser.tenant_id,
      details: { invoice_number: invoice.invoice_number, recipient, provider_message_id: messageId },
    });

    return json(
      { ok: true, message: "Invoice emailed", provider_message_id: messageId },
      200,
      rlHeaders,
    );
  } catch (err: any) {
    return json({ ok: false, error: err?.message || "Internal error" }, 200);
  }
});
