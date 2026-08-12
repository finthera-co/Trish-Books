// ─────────────────────────────────────────────────────────────────────────────
// Builds and maintains the analyst's retrieval index.
//
// Two modes, same machinery:
//   mode: "full"        — rebuild every document for a tenant (first run, or
//                         after a schema change to how records are rendered)
//   mode: "incremental" — drain analyst_index_queue, which the triggers fill
//                         as the books change (this is what cron calls)
//
// The work is bounded per invocation, not per tenant. An edge function has a
// wall clock, and a first full index of a busy tenant is tens of thousands of
// rows — so each call does a slice and reports whether more remains, and the
// caller (cron or the UI's "build index" button) comes back for the rest.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { embedDocuments, MAX_BATCH } from "../_shared/embeddings.ts";
import { corsHeaders as baseCors } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";

// Extends the shared CORS: this route needs its own Allow-Methods.
const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Rows rendered per invocation. Keeps a call well inside the CPU budget. */
const RENDER_LIMIT = 2000;
/** Documents embedded per invocation. The dominant cost and the real cap. */
const EMBED_LIMIT = 480;

type SourceType =
  | "account"
  | "journal_entry"
  | "invoice_line"
  | "bill_line"
  | "customer"
  | "vendor";

interface RenderedDoc {
  tenant_id: string;
  source_type: SourceType;
  source_id: string;
  content: string;
  content_hash: string;
  metadata: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!req.headers.get("Authorization")) return json({ error: "Missing authorization" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const mode: "full" | "incremental" = body.mode === "full" ? "full" : "incremental";

    // A caller may target one tenant (the UI's build button); cron passes none
    // and every active tenant is swept.
    // Only the targeted path is limited. A call with no tenant_id is the
    // machine sweep, and limiting that would silently skip tenants mid-run —
    // same reasoning as the cron exemptions elsewhere. Runs before any render
    // or embedding work, which is the expensive part.
    let rlHeaders: Record<string, string> = {};
    if (body.tenant_id) {
      const { blocked, headers } = await enforceRateLimit(admin, "analyst-reindex", {
        userId: null,
        tenantId: body.tenant_id,
        ip: clientIp(req),
      });
      if (blocked) return blocked;
      rlHeaders = headers;
    }

    const tenantIds: string[] = body.tenant_id
      ? [body.tenant_id]
      : ((await admin.from("tenants").select("id").eq("status", "active")).data ?? [])
          .map((t: any) => t.id);

    const results: unknown[] = [];
    let embedBudget = EMBED_LIMIT;

    for (const tenantId of tenantIds) {
      if (embedBudget <= 0) {
        results.push({ tenant_id: tenantId, skipped: "embedding budget exhausted" });
        continue;
      }
      const result = mode === "full"
        ? await fullReindex(admin, tenantId, embedBudget)
        : await incrementalReindex(admin, tenantId, embedBudget);

      embedBudget -= result.embedded;
      results.push({ tenant_id: tenantId, ...result });
    }

    return json({ mode, results }, 200, rlHeaders);
  } catch (e) {
    console.error("analyst-reindex error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

// ── Modes ────────────────────────────────────────────────────────────────────

async function fullReindex(admin: SupabaseClient, tenantId: string, embedBudget: number) {
  const docs = await renderAll(admin, tenantId);
  const upserted = await upsertDocuments(admin, tenantId, docs);
  const embedded = await embedPending(admin, tenantId, embedBudget);

  const { count: remaining } = await admin
    .from("analyst_documents")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("embedding", null);

  return { rendered: docs.length, upserted, embedded, pending: remaining ?? 0 };
}

async function incrementalReindex(admin: SupabaseClient, tenantId: string, embedBudget: number) {
  const { data: queued } = await admin
    .from("analyst_index_queue")
    .select("source_type, source_id, op")
    .eq("tenant_id", tenantId)
    .order("queued_at", { ascending: true })
    .limit(RENDER_LIMIT);

  const items = queued ?? [];

  if (items.length > 0) {
    const deletes = items.filter((q: any) => q.op === "delete");
    for (const d of deletes) {
      await admin
        .from("analyst_documents")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("source_type", d.source_type)
        .eq("source_id", d.source_id);
    }

    const upsertIds = items.filter((q: any) => q.op === "upsert");
    const byType = new Map<SourceType, string[]>();
    for (const q of upsertIds) {
      const list = byType.get(q.source_type as SourceType) ?? [];
      list.push(q.source_id);
      byType.set(q.source_type as SourceType, list);
    }

    const docs: RenderedDoc[] = [];
    for (const [type, ids] of byType) {
      docs.push(...(await renderByType(admin, tenantId, type, ids)));
    }
    await upsertDocuments(admin, tenantId, docs);

    // Rows that rendered to nothing (a voided entry, a deleted parent) are
    // dequeued anyway — leaving them would make the queue never drain.
    for (const q of items) {
      await admin
        .from("analyst_index_queue")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("source_type", q.source_type)
        .eq("source_id", q.source_id);
    }
  }

  const embedded = await embedPending(admin, tenantId, embedBudget);
  return { dequeued: items.length, embedded, queue_had_more: items.length === RENDER_LIMIT };
}

// ── Rendering ────────────────────────────────────────────────────────────────
//
// Each record becomes one line of text carrying the words a person would use to
// ask about it. The account type is included on purpose: "Advertising (Expense)"
// embeds closer to "what did we spend on marketing" than "Advertising" alone.

async function renderAll(admin: SupabaseClient, tenantId: string): Promise<RenderedDoc[]> {
  const types: SourceType[] = [
    "account", "customer", "vendor", "journal_entry", "invoice_line", "bill_line",
  ];
  const out: RenderedDoc[] = [];
  for (const t of types) {
    out.push(...(await renderByType(admin, tenantId, t, null)));
  }
  return out;
}

async function renderByType(
  admin: SupabaseClient,
  tenantId: string,
  type: SourceType,
  ids: string[] | null,
): Promise<RenderedDoc[]> {
  switch (type) {
    case "account": {
      let q = admin
        .from("accounts")
        .select("id, account_code, account_name, account_type, account_subtype, is_active")
        .eq("tenant_id", tenantId)
        .limit(RENDER_LIMIT);
      if (ids) q = q.in("id", ids);
      const rows = (await q).data ?? [];
      return rows.map((r: any) =>
        doc(tenantId, "account", r.id,
          [r.account_code, r.account_name, r.account_subtype, `(${r.account_type})`]
            .filter(Boolean).join(" · "),
          {
            account_id: r.id,
            account_code: r.account_code,
            account_name: r.account_name,
            account_type: r.account_type,
            active: r.is_active,
          }),
      );
    }

    case "customer": {
      let q = admin
        .from("customers")
        .select("id, customer_code, name, legal_name, notes, status")
        .eq("tenant_id", tenantId)
        .limit(RENDER_LIMIT);
      if (ids) q = q.in("id", ids);
      const rows = (await q).data ?? [];
      return rows.map((r: any) =>
        doc(tenantId, "customer", r.id,
          ["Customer:", r.name, r.legal_name, r.customer_code, r.notes]
            .filter(Boolean).join(" · "),
          { customer_id: r.id, customer_name: r.name, customer_code: r.customer_code }),
      );
    }

    case "vendor": {
      let q = admin
        .from("vendors")
        .select("id, name, email")
        .eq("tenant_id", tenantId)
        .limit(RENDER_LIMIT);
      if (ids) q = q.in("id", ids);
      const rows = (await q).data ?? [];
      return rows.map((r: any) =>
        doc(tenantId, "vendor", r.id,
          ["Vendor / supplier:", r.name].filter(Boolean).join(" "),
          { vendor_id: r.id, vendor_name: r.name }),
      );
    }

    case "journal_entry": {
      // Only posted, un-voided entries: indexing a draft would let the analyst
      // find and cite a transaction that is not in any report.
      let q = admin
        .from("journal_entries")
        .select("id, entry_date, description, reference, entry_type")
        .eq("tenant_id", tenantId)
        .eq("status", "posted")
        .is("voided_at", null)
        .not("description", "is", null)
        .order("entry_date", { ascending: false })
        .limit(RENDER_LIMIT);
      if (ids) q = q.in("id", ids);
      const rows = (await q).data ?? [];
      return rows
        .filter((r: any) => (r.description ?? "").trim())
        .map((r: any) =>
          doc(tenantId, "journal_entry", r.id,
            [r.description, r.reference, `on ${r.entry_date}`].filter(Boolean).join(" · "),
            { entry_id: r.id, entry_date: r.entry_date, reference: r.reference }),
        );
    }

    case "invoice_line": {
      let q = admin
        .from("invoice_items")
        .select("id, description, total, account_id, invoices!inner(tenant_id, invoice_number, issue_date, customer_id)")
        .eq("invoices.tenant_id", tenantId)
        .not("description", "is", null)
        .limit(RENDER_LIMIT);
      if (ids) q = q.in("id", ids);
      const rows = (await q).data ?? [];
      return rows
        .filter((r: any) => (r.description ?? "").trim())
        .map((r: any) =>
          doc(tenantId, "invoice_line", r.id,
            `Sold: ${r.description} · invoice ${r.invoices?.invoice_number ?? ""} · ${r.invoices?.issue_date ?? ""}`,
            {
              invoice_number: r.invoices?.invoice_number,
              issue_date: r.invoices?.issue_date,
              customer_id: r.invoices?.customer_id,
              account_id: r.account_id,
              amount: Number(r.total) || 0,
            }),
        );
    }

    case "bill_line": {
      let q = admin
        .from("supplier_bill_lines")
        .select("id, description, line_total, account_id, supplier_bills!inner(bill_number, bill_date, vendor_id)")
        .eq("tenant_id", tenantId)
        .not("description", "is", null)
        .limit(RENDER_LIMIT);
      if (ids) q = q.in("id", ids);
      const rows = (await q).data ?? [];
      return rows
        .filter((r: any) => (r.description ?? "").trim())
        .map((r: any) =>
          doc(tenantId, "bill_line", r.id,
            `Purchased: ${r.description} · bill ${r.supplier_bills?.bill_number ?? ""} · ${r.supplier_bills?.bill_date ?? ""}`,
            {
              bill_number: r.supplier_bills?.bill_number,
              bill_date: r.supplier_bills?.bill_date,
              vendor_id: r.supplier_bills?.vendor_id,
              account_id: r.account_id,
              amount: Number(r.line_total) || 0,
            }),
        );
    }
  }
}

function doc(
  tenantId: string,
  sourceType: SourceType,
  sourceId: string,
  content: string,
  metadata: Record<string, unknown>,
): RenderedDoc {
  const trimmed = content.trim().slice(0, 2000);
  return {
    tenant_id: tenantId,
    source_type: sourceType,
    source_id: sourceId,
    content: trimmed,
    content_hash: hash(trimmed),
    metadata,
  };
}

/** FNV-1a. Only needs to detect "the text changed", so a cryptographic digest
 *  would be cost without benefit — and this stays synchronous. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// ── Persistence ──────────────────────────────────────────────────────────────

/** Upserts rendered text, clearing the embedding only when the text actually
 *  changed — re-embedding an unchanged row is the single most wasteful thing
 *  this function could do. */
async function upsertDocuments(
  admin: SupabaseClient,
  tenantId: string,
  docs: RenderedDoc[],
): Promise<number> {
  if (docs.length === 0) return 0;

  const existing = new Map<string, string>();
  for (let i = 0; i < docs.length; i += 500) {
    const slice = docs.slice(i, i + 500);
    const { data } = await admin
      .from("analyst_documents")
      .select("source_type, source_id, content_hash")
      .eq("tenant_id", tenantId)
      .in("source_id", slice.map((d) => d.source_id));
    for (const r of data ?? []) {
      existing.set(`${(r as any).source_type}:${(r as any).source_id}`, (r as any).content_hash);
    }
  }

  const changed = docs.filter(
    (d) => existing.get(`${d.source_type}:${d.source_id}`) !== d.content_hash,
  );
  if (changed.length === 0) return 0;

  for (let i = 0; i < changed.length; i += 500) {
    const { error } = await admin
      .from("analyst_documents")
      .upsert(
        changed.slice(i, i + 500).map((d) => ({
          ...d,
          embedding: null,
          indexed_at: null,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "tenant_id,source_type,source_id" },
      );
    if (error) throw new Error(`Document upsert failed: ${error.message}`);
  }
  return changed.length;
}

/** Embeds rows whose text has no vector yet, up to the caller's budget. */
async function embedPending(
  admin: SupabaseClient,
  tenantId: string,
  budget: number,
): Promise<number> {
  let embedded = 0;

  while (embedded < budget) {
    const take = Math.min(MAX_BATCH, budget - embedded);
    const { data: pending, error } = await admin
      .from("analyst_documents")
      .select("id, content")
      .eq("tenant_id", tenantId)
      .is("embedding", null)
      .limit(take);

    if (error) throw new Error(`Could not read pending documents: ${error.message}`);
    if (!pending?.length) break;

    const vectors = await embedDocuments(pending.map((p: any) => p.content));

    // One row at a time: PostgREST has no bulk update-by-differing-value, and
    // an upsert here would need every column round-tripped just to set one.
    await Promise.all(
      pending.map((row: any, i: number) =>
        admin
          .from("analyst_documents")
          .update({
            embedding: JSON.stringify(vectors[i]),
            indexed_at: new Date().toISOString(),
          })
          .eq("id", row.id),
      ),
    );

    embedded += pending.length;
    if (pending.length < take) break;
  }

  return embedded;
}

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}
