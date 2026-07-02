import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Resend delivery webhook → updates invoice_emails / invoices with open + bounce
// state. Resend signs requests with Svix; we verify the signature before trusting
// any event. Configure the endpoint URL + signing secret in the Resend dashboard
// and set RESEND_WEBHOOK_SECRET (the "whsec_..." value).

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Constant-time-ish comparison.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySvix(secret: string, headers: Headers, payload: string): Promise<boolean> {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  // Secret is "whsec_<base64>"; the HMAC key is the decoded base64 portion.
  const secretBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signedContent = `${id}.${timestamp}.${payload}`;
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // Header is a space-separated list of "v1,<base64sig>" entries.
  return signatureHeader.split(" ").some((part) => {
    const [, value] = part.split(",");
    return value && safeEqual(value, expected);
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  const raw = await req.text();

  if (secret) {
    const valid = await verifySvix(secret, req.headers, raw).catch(() => false);
    if (!valid) return json({ ok: false, error: "Invalid signature" }, 401);
  }

  let event: any;
  try { event = JSON.parse(raw); } catch { return json({ ok: false, error: "Bad JSON" }, 400); }

  const type: string = event?.type || "";
  const messageId: string | undefined = event?.data?.email_id;
  if (!messageId) return json({ ok: true, ignored: "no email_id" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Map the Resend event onto our delivery state.
  let logPatch: Record<string, unknown> | null = null;
  let invoicePatch: Record<string, unknown> | null = null;
  if (type === "email.opened") {
    const now = new Date().toISOString();
    logPatch = { status: "opened", opened_at: now };
    invoicePatch = { email_status: "opened" };
  } else if (type === "email.bounced" || type === "email.complained") {
    logPatch = { status: "failed", error: type };
    invoicePatch = { email_status: "failed" };
  }
  if (!logPatch) return json({ ok: true, ignored: type });

  const { data: rows } = await admin
    .from("invoice_emails")
    .select("id, invoice_id, opened_at")
    .eq("provider_message_id", messageId)
    .limit(1);
  const row = rows?.[0];
  if (!row) return json({ ok: true, ignored: "unknown message" });

  // Don't downgrade an already-opened row back to "sent" on later events.
  if (type === "email.opened" && row.opened_at) return json({ ok: true, dedup: true });

  await admin.from("invoice_emails").update(logPatch).eq("id", row.id);
  if (invoicePatch) await admin.from("invoices").update(invoicePatch).eq("id", row.invoice_id);

  return json({ ok: true, type, invoice_id: row.invoice_id });
});
