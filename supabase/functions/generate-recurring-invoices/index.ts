import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { calculateLineTax, type TaxMemberInput } from "../_shared/taxEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TERM_DAYS: Record<string, number> = {
  due_on_receipt: 0, net_15: 15, net_30: 30, net_45: 45, net_60: 60,
};
const addDays = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const round2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const today = new Date().toISOString().slice(0, 10);

  // Active schedules that are due.
  const { data: schedules, error } = await admin
    .from("recurring_invoices")
    .select("*, recurring_invoice_items(*)")
    .eq("status", "active")
    .lte("next_run_date", today);
  if (error) return json({ ok: false, error: error.message });

  let generated = 0;
  let posted = 0;
  const failures: { id: string; error: string }[] = [];

  for (const sch of schedules ?? []) {
    try {
      const items = (sch.recurring_invoice_items ?? []) as any[];
      if (items.length === 0) throw new Error("Template has no line items");

      const issueDate: string = sch.next_run_date;
      const dueDate = addDays(issueDate, TERM_DAYS[sch.payment_terms] ?? 30);

      // ── Tax profile + codes/rates for this tenant (engine inputs) ──
      const { data: taxProfile } = await admin
        .from("tenant_tax_profiles").select("*").eq("tenant_id", sch.tenant_id).maybeSingle();

      const codeIds = new Set<string>();
      const groupIds = new Set<string>();
      for (const it of items) {
        if (it.tax_code_id) codeIds.add(it.tax_code_id);
        if (it.tax_group_id) groupIds.add(it.tax_group_id);
      }
      const { data: groupMembers } = groupIds.size
        ? await admin.from("tax_group_members")
            .select("tax_group_id, tax_code_id, apply_order, compound_on_previous")
            .in("tax_group_id", [...groupIds])
        : { data: [] as any[] };
      for (const gm of groupMembers ?? []) codeIds.add(gm.tax_code_id);

      const { data: codes } = codeIds.size
        ? await admin.from("tax_codes")
            .select("id, code, collection_mode, rounding_method").in("id", [...codeIds])
        : { data: [] as any[] };
      const codeById = new Map<string, any>((codes ?? []).map((c: any) => [c.id, c]));

      const { data: rates } = codeIds.size
        ? await admin.from("tax_code_rates")
            .select("tax_code_id, rate, effective_from, effective_to").in("tax_code_id", [...codeIds])
        : { data: [] as any[] };
      const rateFor = (codeId: string): number | null => {
        const c = (rates ?? [])
          .filter((r: any) => r.tax_code_id === codeId && r.effective_from <= issueDate && (!r.effective_to || r.effective_to >= issueDate))
          .sort((a: any, b: any) => (a.effective_from < b.effective_from ? 1 : -1));
        return c.length ? Number(c[0].rate) : null;
      };

      // ── Compute totals exactly like post-invoice (so auto-post matches) ──
      let subtotal = 0, taxAmount = 0;
      const itemRows: any[] = [];
      for (const it of items) {
        const lineAmount = Number(it.quantity) * Number(it.unit_price) - Number(it.discount_amount || 0);
        let lineTotal = round2(Math.max(0, lineAmount));
        if (it.tax_code_id || it.tax_group_id) {
          const memberDefs = it.tax_group_id
            ? (groupMembers ?? []).filter((gm: any) => gm.tax_group_id === it.tax_group_id)
                .map((gm: any) => ({ codeId: gm.tax_code_id, order: gm.apply_order, compound: gm.compound_on_previous }))
            : [{ codeId: it.tax_code_id, order: 1, compound: false }];
          const members: TaxMemberInput[] = [];
          for (const md of memberDefs) {
            const c = codeById.get(md.codeId);
            const rate = rateFor(md.codeId);
            if (!c || rate === null) continue;
            members.push({ taxCodeId: c.id, code: c.code, rate, isCompound: md.compound, applyOrder: md.order, collectionMode: c.collection_mode });
          }
          if (members.length) {
            const first = codeById.get(members[0].taxCodeId);
            const r = calculateLineTax({
              lineAmount, isInclusive: !!it.is_tax_inclusive, members,
              roundingMethod: (first?.rounding_method as any) || "half_up", roundingLevel: "line", documentDate: issueDate,
            });
            subtotal += r.exclusiveBase;
            for (const t of r.taxes) taxAmount += t.amount;
            lineTotal = r.lineTotal;
          } else {
            subtotal += lineTotal;
          }
        } else {
          subtotal += lineTotal;
        }
        itemRows.push({
          description: it.description, quantity: it.quantity, unit_price: it.unit_price,
          total: lineTotal, product_id: it.product_id, account_id: it.account_id,
          discount_amount: it.discount_amount, is_tax_inclusive: it.is_tax_inclusive,
          tax_code_id: it.tax_code_id, tax_group_id: it.tax_group_id,
        });
      }
      subtotal = round2(subtotal);
      taxAmount = round2(taxAmount);
      const total = round2(subtotal + taxAmount);
      const discountTotal = round2(items.reduce((s: number, it: any) => s + Number(it.discount_amount || 0), 0));

      // ── Serial + invoice header ──
      const { data: serial, error: serErr } = await admin.rpc("next_invoice_serial", {
        p_branch_code: (sch.branch_code || "REC").trim(),
        p_issue_date: issueDate,
      });
      if (serErr || !serial) throw new Error(serErr?.message || "Serial generation failed");

      const { data: invoice, error: invErr } = await admin.from("invoices").insert({
        tenant_id: sch.tenant_id,
        customer_id: sch.customer_id,
        invoice_number: serial,
        issue_date: issueDate,
        due_date: dueDate,
        payment_terms: sch.payment_terms,
        date_of_supply: issueDate,
        branch_code: (sch.branch_code || "REC").trim(),
        total_amount: total, subtotal, tax_amount: taxAmount, discount_amount: discountTotal,
        notes: sch.notes, terms: sch.terms,
        status: "draft",
      } as any).select("id").single();
      if (invErr) throw invErr;

      const { error: itemErr } = await admin.from("invoice_items")
        .insert(itemRows.map((r) => ({ ...r, invoice_id: invoice.id })));
      if (itemErr) throw itemErr;
      generated++;

      // ── Advance the schedule ──
      const nextRun = addByFrequency(issueDate, sch.frequency, sch.interval_count);
      const occ = (sch.occurrences_generated || 0) + 1;
      const reachedMax = sch.max_occurrences != null && occ >= sch.max_occurrences;
      const reachedEnd = sch.end_date != null && nextRun > sch.end_date;
      await admin.from("recurring_invoices").update({
        occurrences_generated: occ,
        next_run_date: nextRun,
        status: reachedMax || reachedEnd ? "completed" : "active",
        updated_at: new Date().toISOString(),
      }).eq("id", sch.id);

      // ── Optional auto-post (system call into post-invoice) ──
      if (sch.auto_post) {
        const resp = await fetch(`${supabaseUrl}/functions/v1/post-invoice`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            invoice_id: invoice.id, action: "post",
            system: true, tenant_id: sch.tenant_id, actor_user_id: sch.created_by,
          }),
        });
        const r = await resp.json().catch(() => ({}));
        if (r?.ok) posted++;
        else failures.push({ id: sch.id, error: `auto-post: ${r?.error || resp.status}` });
      }
    } catch (e: any) {
      failures.push({ id: sch.id, error: e?.message || "unknown" });
    }
  }

  return json({ ok: true, scanned: schedules?.length ?? 0, generated, posted, failures });
});

// JS mirror of recurring_next_date (kept here so we don't round-trip to the DB).
function addByFrequency(from: string, frequency: string, interval: number): string {
  const d = new Date(from + "T00:00:00Z");
  switch (frequency) {
    case "weekly": d.setUTCDate(d.getUTCDate() + interval * 7); break;
    case "quarterly": d.setUTCMonth(d.getUTCMonth() + interval * 3); break;
    case "yearly": d.setUTCFullYear(d.getUTCFullYear() + interval); break;
    case "monthly":
    default: d.setUTCMonth(d.getUTCMonth() + interval); break;
  }
  return d.toISOString().slice(0, 10);
}
