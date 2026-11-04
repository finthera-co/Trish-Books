// ─────────────────────────────────────────────────────────────────────────────
// The bookkeeping agent's tool surface.
//
// Two kinds of tool. Read tools are a subset of the analyst's (see
// analystTools.ts) plus the lookups an action needs: open suspense lines,
// vendors, customers, tax codes. Propose tools write ONE thing — a pending row
// in agent_proposals — and nothing else. No tool here posts, edits or deletes a
// ledger record; that only happens when a person approves the proposal and the
// browser runs it through the app's existing path (validate-journal-entry,
// clear_suspense_lines, the bill form), on the approver's JWT.
//
// Everything runs on the caller's client, so RLS is the tenant boundary. The
// propose tools still validate against the books before inserting: the apply
// path re-validates on approval regardless, but an error caught here goes back
// to the model while it can still fix it, instead of to a reviewer later.
// ─────────────────────────────────────────────────────────────────────────────

import { ANALYST_TOOLS, type AnalystTool, type ToolContext } from "./analystTools.ts";

export interface BookkeepingContext extends ToolContext {
  /** public.users.id of the caller — the proposal's proposed_by. */
  userId: string;
  conversationId: string;
}

export interface BookkeepingTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (input: Record<string, any>, ctx: BookkeepingContext) => Promise<unknown>;
}

/** Thrown for a proposal the books reject. The loop returns it to the model as
 *  an error tool_result listing every problem, so it can fix them all at once. */
export class ProposalRejected extends Error {
  constructor(public problems: string[]) {
    super(`Proposal not created:\n- ${problems.join("\n- ")}`);
  }
}

const DATE = { type: "string", description: "ISO date, YYYY-MM-DD" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Matches validate-journal-entry's EPSILON. */
const EPSILON = 0.005;
/** Matches LINE_MEMO_MIN / LINE_MEMO_MAX in validate-journal-entry. */
const LINE_MEMO_MIN = 3;
const LINE_MEMO_MAX = 200;
/** One proposal should be reviewable in one sitting. */
const MAX_SUSPENSE_LINES = 500;
const MAX_DOC_LINES = 50;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} failed: ${res.error.message}`);
  return (res.data ?? []) as T;
}

/** Model-supplied text headed for a reviewer's screen: trimmed and bounded. */
function text(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}

function idList(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.map(String).filter((s) => UUID_RE.test(s)))] : [];
}

/** Postable, active accounts in this tenant, keyed by id. Missing ids are simply
 *  absent — RLS hides another tenant's accounts the same way it hides a typo. */
async function loadAccounts(ctx: BookkeepingContext, ids: string[]) {
  if (ids.length === 0) return new Map<string, any>();
  const rows = unwrap(
    await ctx.supabase
      .from("accounts")
      .select("id, account_code, account_name, account_type, account_subtype, is_active, is_postable")
      .eq("tenant_id", ctx.tenantId)
      .in("id", ids) as any,
    "account lookup",
  ) as any[];
  return new Map(rows.map((r) => [r.id, r]));
}

function checkAccount(acc: any, id: string, label: string, problems: string[]) {
  if (!acc) problems.push(`${label}: account ${id} does not exist in this company`);
  else if (!acc.is_active) problems.push(`${label}: account ${acc.account_code} ${acc.account_name} is inactive`);
  else if (!acc.is_postable) problems.push(`${label}: account ${acc.account_code} ${acc.account_name} is a header and cannot be posted to`);
}

async function isPeriodClosed(ctx: BookkeepingContext, date: string): Promise<boolean> {
  const { data } = await ctx.supabase.rpc("is_period_closed", {
    p_tenant_id: ctx.tenantId,
    p_date: date,
  });
  return data === true;
}

/** Every propose tool takes these two, and the reviewer reads both first. */
const REVIEW_FIELDS = {
  title: {
    type: "string",
    description: "One line the reviewer scans in a list, e.g. 'Clear 14 Dialog Axiata payments to 6120 Telephone'. 3-200 chars.",
  },
  rationale: {
    type: "string",
    description:
      "Why this is right, citing the evidence you looked at: the engine's suggestion, how the same " +
      "counterparty was coded before, the document details. Say plainly if anything is uncertain.",
  },
};

async function insertProposal(
  ctx: BookkeepingContext,
  kind: "journal_entry" | "supplier_bill" | "clear_suspense",
  input: Record<string, any>,
  payload: Record<string, unknown>,
  preview: Record<string, unknown>,
) {
  const title = text(input.title, 200);
  if (title.length < 3) throw new ProposalRejected(["title is required (3-200 characters)"]);

  const res = await ctx.supabase
    .from("agent_proposals")
    .insert({
      tenant_id: ctx.tenantId,
      conversation_id: ctx.conversationId,
      proposed_by: ctx.userId,
      kind,
      title,
      rationale: text(input.rationale, 4000),
      payload,
      preview,
    })
    .select("id, kind, title, status, created_at")
    .single();
  if (res.error) throw new Error(`Could not save proposal: ${res.error.message}`);

  return {
    proposal: { ...res.data, preview },
    note: "Saved as a pending proposal. Nothing has been posted — a person must approve it.",
  };
}

// ── Read tools reused from the analyst ───────────────────────────────────────

const REUSED_ANALYST_TOOLS = [
  "search_financial_context",
  "list_accounts",
  "get_account_ledger",
  "get_account_balances",
  "get_trial_balance",
  "get_payables_aging",
  "get_fiscal_context",
];

const reused: BookkeepingTool[] = REUSED_ANALYST_TOOLS.map((name) => {
  const tool = ANALYST_TOOLS.find((t) => t.name === name) as AnalystTool | undefined;
  if (!tool) throw new Error(`analystTools no longer exports ${name}`);
  return tool as unknown as BookkeepingTool;
});

// ── Read tools for actions ───────────────────────────────────────────────────

const lookups: BookkeepingTool[] = [
  {
    name: "list_suspense_lines",
    description:
      "Imported bank statement lines still sitting in Suspense, waiting to be reclassified. Each " +
      "line has the bank's own text (description, name, raw_account_type), the amount (debit = " +
      "money out, credit = money in), why the import engine could not code it (suspense_reason), " +
      "and the engine's ranked account suggestions. Also returns a summary grouping open lines " +
      "by raw_account_type, which is how lines that belong to the same counterparty cluster — " +
      "work a cluster at a time. Use the line ids with propose_clear_suspense.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Case-insensitive filter on description, name or raw_account_type." },
        raw_account_type: { type: "string", description: "Exact raw_account_type to list one cluster." },
        date_from: DATE,
        date_to: DATE,
        limit: { type: "integer", description: "Max lines, 1-500. Default 100." },
      },
    },
    async run(input, ctx) {
      const limit = Math.min(MAX_SUSPENSE_LINES, Math.max(1, Number(input.limit) || 100));
      let q = ctx.supabase
        .from("bank_statement_lines")
        .select("id, txn_date, description, name, raw_account_type, canonical_category, debit, credit, suspense_reason, suggestions, bank_statement_batches(bank_account_id, file_name)")
        .eq("tenant_id", ctx.tenantId)
        .eq("needs_reclassification", true)
        .order("txn_date", { ascending: true })
        .limit(limit);

      if (input.raw_account_type) q = q.eq("raw_account_type", String(input.raw_account_type));
      if (input.date_from) q = q.gte("txn_date", input.date_from);
      if (input.date_to) q = q.lte("txn_date", input.date_to);
      if (input.search) {
        // PostgREST's or() syntax breaks on commas and parentheses, so they are
        // stripped from the term rather than escaped.
        const term = String(input.search).replace(/[,()*%]/g, " ").trim();
        if (term) {
          q = q.or(`description.ilike.%${term}%,name.ilike.%${term}%,raw_account_type.ilike.%${term}%`);
        }
      }

      const rows = unwrap(await q as any, "list_suspense_lines") as any[];

      // The cluster summary covers every open line, not just this page, so the
      // model can see the shape of the backlog before deciding where to start.
      const all = unwrap(
        await ctx.supabase
          .from("bank_statement_lines")
          .select("raw_account_type, debit, credit")
          .eq("tenant_id", ctx.tenantId)
          .eq("needs_reclassification", true)
          .limit(20000) as any,
        "suspense summary",
      ) as any[];
      const clusters = new Map<string, { lines: number; out: number; in: number }>();
      for (const r of all) {
        const k = r.raw_account_type || "(blank)";
        const c = clusters.get(k) ?? { lines: 0, out: 0, in: 0 };
        c.lines += 1;
        c.out += num(r.debit);
        c.in += num(r.credit);
        clusters.set(k, c);
      }

      return {
        open_lines_total: all.length,
        lines: rows.map((r) => ({
          line_id: r.id,
          date: r.txn_date,
          description: r.description,
          name: r.name,
          raw_account_type: r.raw_account_type,
          category: r.canonical_category,
          money_out: num(r.debit) || undefined,
          money_in: num(r.credit) || undefined,
          suspense_reason: r.suspense_reason,
          suggestions: Array.isArray(r.suggestions) ? r.suggestions.slice(0, 3) : [],
          file: r.bank_statement_batches?.file_name ?? null,
        })),
        clusters: [...clusters.entries()]
          .sort((a, b) => b[1].lines - a[1].lines)
          .slice(0, 40)
          .map(([raw_account_type, c]) => ({
            raw_account_type,
            lines: c.lines,
            money_out: round2(c.out),
            money_in: round2(c.in),
          })),
        truncated: rows.length === limit,
      };
    },
  },
  {
    name: "find_vendors",
    description:
      "Look up suppliers by name. A supplier bill needs a vendor_id from here — if the supplier " +
      "does not exist, say so; you cannot create vendors.",
    input_schema: {
      type: "object",
      properties: {
        name_contains: { type: "string", description: "Case-insensitive substring. Omit to list all." },
      },
    },
    async run(input, ctx) {
      let q = ctx.supabase
        .from("vendors")
        .select("id, name, payment_terms, currency, tin, email")
        .eq("tenant_id", ctx.tenantId)
        .order("name")
        .limit(100);
      if (input.name_contains) q = q.ilike("name", `%${input.name_contains}%`);
      const rows = unwrap(await q as any, "find_vendors") as any[];
      return { vendors: rows.map((r) => ({ vendor_id: r.id, ...r, id: undefined })) };
    },
  },
  {
    name: "find_customers",
    description:
      "Look up customers by name. Needed to tag a journal line that hits the Accounts Receivable " +
      "control account with the customer it belongs to.",
    input_schema: {
      type: "object",
      properties: {
        name_contains: { type: "string", description: "Case-insensitive substring. Omit to list all." },
      },
    },
    async run(input, ctx) {
      let q = ctx.supabase
        .from("customers")
        .select("id, name, email")
        .eq("tenant_id", ctx.tenantId)
        .order("name")
        .limit(100);
      if (input.name_contains) q = q.ilike("name", `%${input.name_contains}%`);
      const rows = unwrap(await q as any, "find_customers") as any[];
      return { customers: rows.map((r) => ({ customer_id: r.id, name: r.name, email: r.email })) };
    },
  },
  {
    name: "list_tax_codes",
    description:
      "Active tax codes and tax groups (VAT, SSCL, WHT …) for bill lines. Only apply one when the " +
      "source document shows that tax — the reviewer's bill form computes the amount from it.",
    input_schema: { type: "object", properties: {} },
    async run(_input, ctx) {
      const [codes, groups] = await Promise.all([
        ctx.supabase
          .from("tax_codes")
          .select("id, code, name, tax_type, is_recoverable, is_inclusive_default")
          .eq("tenant_id", ctx.tenantId)
          .eq("is_active", true)
          .order("code"),
        ctx.supabase
          .from("tax_groups")
          .select("id, code, name")
          .eq("tenant_id", ctx.tenantId)
          .eq("is_active", true)
          .order("code"),
      ]);
      return {
        tax_codes: unwrap(codes as any, "tax codes"),
        tax_groups: unwrap(groups as any, "tax groups"),
      };
    },
  },
  {
    name: "list_agent_proposals",
    description:
      "Proposals already in the review queue, with their status. Check pending ones before " +
      "proposing, so you never queue the same action twice; read rejected ones to learn what " +
      "the reviewer did not accept and why.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "applying", "applied", "rejected", "failed"],
          description: "Filter by status. Omit for the 50 most recent of any status.",
        },
      },
    },
    async run(input, ctx) {
      let q = ctx.supabase
        .from("agent_proposals")
        .select("id, kind, status, title, rationale, preview, error, created_at, decided_at")
        .eq("tenant_id", ctx.tenantId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (input.status) q = q.eq("status", input.status);
      const rows = unwrap(await q as any, "list_agent_proposals") as any[];
      return {
        proposals: rows.map((r) => ({
          proposal_id: r.id,
          kind: r.kind,
          status: r.status,
          title: r.title,
          preview: r.preview,
          // On a rejection this is the reviewer's reason.
          reviewer_note: r.error ?? undefined,
          created_at: r.created_at,
        })),
      };
    },
  },
];

// ── Propose tools ────────────────────────────────────────────────────────────

const proposals: BookkeepingTool[] = [
  {
    name: "propose_clear_suspense",
    description:
      "Propose moving a group of open suspense lines to the account they belong in. On approval " +
      "the app's own suspense-clearing runs: open-period lines have their original entry re-coded, " +
      "closed-period lines get a reclassification entry. Group lines that genuinely share one " +
      "account — typically one counterparty — and propose one group per call. Set teach_rule only " +
      "when every line shares the same raw_account_type AND that text will always mean this " +
      "account; the import engine then codes it automatically next time.",
    input_schema: {
      type: "object",
      properties: {
        line_ids: {
          type: "array",
          items: { type: "string" },
          description: `line_id values from list_suspense_lines. 1-${MAX_SUSPENSE_LINES}.`,
        },
        target_account_id: { type: "string", description: "The account the lines belong in." },
        memo: { type: "string", description: "Optional narration for the reclassified lines (max 200)." },
        teach_rule: { type: "boolean", description: "Also teach the import engine this mapping. Default false." },
        ...REVIEW_FIELDS,
      },
      required: ["line_ids", "target_account_id", "title", "rationale"],
    },
    async run(input, ctx) {
      const problems: string[] = [];
      const lineIds = idList(input.line_ids);
      const targetId = String(input.target_account_id ?? "");

      if (lineIds.length === 0) problems.push("line_ids must contain at least one valid line id");
      if (lineIds.length > MAX_SUSPENSE_LINES) problems.push(`at most ${MAX_SUSPENSE_LINES} lines per proposal`);

      const [lines, accounts, settings, pending] = await Promise.all([
        lineIds.length
          ? ctx.supabase
              .from("bank_statement_lines")
              .select("id, txn_date, description, raw_account_type, debit, credit, needs_reclassification")
              .eq("tenant_id", ctx.tenantId)
              .in("id", lineIds.slice(0, MAX_SUSPENSE_LINES))
          : Promise.resolve({ data: [], error: null }),
        loadAccounts(ctx, UUID_RE.test(targetId) ? [targetId] : []),
        ctx.supabase.from("account_settings").select("suspense_account_id").eq("tenant_id", ctx.tenantId).maybeSingle(),
        ctx.supabase
          .from("agent_proposals")
          .select("id, title, payload")
          .eq("tenant_id", ctx.tenantId)
          .eq("kind", "clear_suspense")
          .in("status", ["pending", "applying"]),
      ]);

      const found = unwrap(lines as any, "suspense line lookup") as any[];
      const byId = new Map(found.map((l) => [l.id, l]));
      const missing = lineIds.filter((id) => !byId.has(id));
      const cleared = found.filter((l) => !l.needs_reclassification).map((l) => l.id);
      if (missing.length) problems.push(`these lines do not exist: ${missing.slice(0, 10).join(", ")}`);
      if (cleared.length) problems.push(`these lines are no longer in suspense: ${cleared.slice(0, 10).join(", ")}`);

      const acc = accounts.get(targetId);
      checkAccount(acc, targetId, "target_account_id", problems);
      if (acc && (settings.data as any)?.suspense_account_id === targetId) {
        problems.push("target_account_id is the suspense account itself");
      }

      // Two pending proposals for one line would make the second fail on
      // approval — or worse, re-code a line the reviewer already settled.
      const taken = new Map<string, string>();
      for (const p of (pending.data ?? []) as any[]) {
        for (const id of p.payload?.line_ids ?? []) taken.set(id, p.title);
      }
      const overlap = lineIds.filter((id) => taken.has(id));
      if (overlap.length) {
        problems.push(
          `${overlap.length} line(s) are already in a pending proposal ("${taken.get(overlap[0])}") — leave them out`,
        );
      }

      let teachVariant: string | null = null;
      if (input.teach_rule === true && found.length) {
        const variants = new Set(found.map((l) => l.raw_account_type));
        if (variants.size !== 1) {
          problems.push("teach_rule needs every line to share one raw_account_type; these lines have " + variants.size);
        } else {
          teachVariant = [...variants][0];
        }
      }

      if (problems.length) throw new ProposalRejected(problems);

      const moneyOut = round2(found.reduce((s, l) => s + num(l.debit), 0));
      const moneyIn = round2(found.reduce((s, l) => s + num(l.credit), 0));
      const dates = found.map((l) => l.txn_date).filter(Boolean).sort();

      return insertProposal(
        ctx,
        "clear_suspense",
        input,
        {
          line_ids: lineIds,
          target_account_id: targetId,
          memo: text(input.memo, 200) || null,
          teach_variant: teachVariant,
        },
        {
          target_account: `${acc.account_code} ${acc.account_name}`,
          line_count: found.length,
          money_out: moneyOut,
          money_in: moneyIn,
          date_from: dates[0] ?? null,
          date_to: dates[dates.length - 1] ?? null,
          teach_variant: teachVariant,
          sample: found.slice(0, 5).map((l) => ({
            date: l.txn_date,
            description: l.description,
            amount: num(l.debit) ? -num(l.debit) : num(l.credit),
          })),
        },
      );
    },
  },
  {
    name: "propose_journal_entry",
    description:
      "Propose a manual journal entry — accruals, prepayments, reclassifications between accounts, " +
      "corrections. On approval it goes through the same validation and posting as an entry " +
      "typed on the Journal Entries page. Rules: at least two lines; each line is a debit OR a " +
      "credit, positive; debits equal credits; each account appears once; every line needs a memo " +
      `(${LINE_MEMO_MIN}-${LINE_MEMO_MAX} chars); the date cannot fall in a closed period. Lines on ` +
      "the Accounts Receivable or Payable control accounts should carry the customer_id or " +
      "vendor_id they belong to. Do not use this to clear suspense lines — use propose_clear_suspense.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Entry narration, min 3 chars." },
        entry_date: DATE,
        reference: { type: "string", description: "Optional reference, e.g. an accrual ref." },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              account_id: { type: "string" },
              debit: { type: "number" },
              credit: { type: "number" },
              memo: { type: "string" },
              customer_id: { type: "string" },
              vendor_id: { type: "string" },
            },
            required: ["account_id", "memo"],
          },
        },
        ...REVIEW_FIELDS,
      },
      required: ["description", "entry_date", "lines", "title", "rationale"],
    },
    async run(input, ctx) {
      const problems: string[] = [];
      const description = text(input.description, 500);
      const entryDate = String(input.entry_date ?? "");
      const rawLines: any[] = Array.isArray(input.lines) ? input.lines.slice(0, MAX_DOC_LINES) : [];

      if (description.length < 3) problems.push("description is required (min 3 characters)");
      if (!DATE_RE.test(entryDate)) problems.push("entry_date must be YYYY-MM-DD");
      else if (await isPeriodClosed(ctx, entryDate)) problems.push(`entry_date ${entryDate} is in a closed period`);

      const lines = rawLines.map((l) => ({
        account_id: String(l?.account_id ?? ""),
        debit: round2(num(l?.debit)),
        credit: round2(num(l?.credit)),
        memo: text(l?.memo, LINE_MEMO_MAX + 1),
        customer_id: UUID_RE.test(String(l?.customer_id ?? "")) ? String(l.customer_id) : null,
        vendor_id: UUID_RE.test(String(l?.vendor_id ?? "")) ? String(l.vendor_id) : null,
      }));

      if (lines.length < 2) problems.push("at least two lines are required");
      lines.forEach((l, i) => {
        const n = `line ${i + 1}`;
        if (l.debit < 0 || l.credit < 0) problems.push(`${n}: amounts must be positive`);
        if (l.debit > 0 && l.credit > 0) problems.push(`${n}: cannot have both a debit and a credit`);
        if (l.debit === 0 && l.credit === 0) problems.push(`${n}: needs a debit or a credit`);
        if (l.memo.length < LINE_MEMO_MIN || l.memo.length > LINE_MEMO_MAX) {
          problems.push(`${n}: memo must be ${LINE_MEMO_MIN}-${LINE_MEMO_MAX} characters`);
        }
      });

      const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
      const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
      if (Math.abs(totalDebit - totalCredit) > EPSILON) {
        problems.push(`debits (${totalDebit}) do not equal credits (${totalCredit})`);
      }

      const ids = lines.map((l) => l.account_id);
      if (new Set(ids).size !== ids.length) problems.push("an account appears on more than one line — combine them");

      const accounts = await loadAccounts(ctx, ids.filter((id) => UUID_RE.test(id)));
      lines.forEach((l, i) => checkAccount(accounts.get(l.account_id), l.account_id, `line ${i + 1}`, problems));

      if (problems.length) throw new ProposalRejected(problems);

      return insertProposal(
        ctx,
        "journal_entry",
        input,
        {
          description,
          entry_date: entryDate,
          reference: text(input.reference, 100) || null,
          lines,
        },
        {
          entry_date: entryDate,
          total: totalDebit,
          lines: lines.map((l) => {
            const a = accounts.get(l.account_id);
            return {
              account: `${a.account_code} ${a.account_name}`,
              debit: l.debit || undefined,
              credit: l.credit || undefined,
              memo: l.memo,
            };
          }),
        },
      );
    },
  },
  {
    name: "propose_supplier_bill",
    description:
      "Propose a supplier bill. On approval the reviewer opens it pre-filled in the Enter Bill " +
      "form, where tax is computed, duplicates are checked and the bill is saved as a DRAFT — " +
      "posting it stays a separate, human step. Amounts are before tax unless a line says " +
      "is_tax_inclusive. Only set a tax code when the document shows that tax.",
    input_schema: {
      type: "object",
      properties: {
        vendor_id: { type: "string", description: "From find_vendors." },
        bill_date: DATE,
        due_date: { ...DATE, description: "Optional; the form derives it from payment terms when omitted." },
        vendor_ref: { type: "string", description: "The supplier's own invoice number." },
        memo: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              account_id: { type: "string", description: "Expense or asset account for this line." },
              description: { type: "string" },
              qty: { type: "number", description: "Default 1." },
              unit_cost: { type: "number" },
              tax_code_id: { type: "string" },
              tax_group_id: { type: "string" },
              is_tax_inclusive: { type: "boolean" },
            },
            required: ["account_id", "unit_cost"],
          },
        },
        ...REVIEW_FIELDS,
      },
      required: ["vendor_id", "bill_date", "lines", "title", "rationale"],
    },
    async run(input, ctx) {
      const problems: string[] = [];
      const vendorId = String(input.vendor_id ?? "");
      const billDate = String(input.bill_date ?? "");
      const dueDate = input.due_date ? String(input.due_date) : null;
      const vendorRef = text(input.vendor_ref, 100) || null;
      const rawLines: any[] = Array.isArray(input.lines) ? input.lines.slice(0, MAX_DOC_LINES) : [];

      if (!DATE_RE.test(billDate)) problems.push("bill_date must be YYYY-MM-DD");
      if (dueDate && !DATE_RE.test(dueDate)) problems.push("due_date must be YYYY-MM-DD");

      const lines = rawLines.map((l) => ({
        account_id: String(l?.account_id ?? ""),
        description: text(l?.description, 500),
        qty: num(l?.qty) || 1,
        unit_cost: round2(num(l?.unit_cost)),
        tax_code_id: UUID_RE.test(String(l?.tax_code_id ?? "")) ? String(l.tax_code_id) : null,
        tax_group_id: UUID_RE.test(String(l?.tax_group_id ?? "")) ? String(l.tax_group_id) : null,
        is_tax_inclusive: l?.is_tax_inclusive === true,
      }));
      if (lines.length === 0) problems.push("at least one line is required");
      lines.forEach((l, i) => {
        if (l.unit_cost <= 0) problems.push(`line ${i + 1}: unit_cost must be positive`);
        if (l.qty <= 0) problems.push(`line ${i + 1}: qty must be positive`);
        if (l.tax_code_id && l.tax_group_id) problems.push(`line ${i + 1}: use a tax code or a tax group, not both`);
      });

      const [vendor, accounts, dupes] = await Promise.all([
        UUID_RE.test(vendorId)
          ? ctx.supabase.from("vendors").select("id, name").eq("tenant_id", ctx.tenantId).eq("id", vendorId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        loadAccounts(ctx, lines.map((l) => l.account_id).filter((id) => UUID_RE.test(id))),
        vendorRef && UUID_RE.test(vendorId)
          ? ctx.supabase
              .from("supplier_bills")
              .select("bill_number, status")
              .eq("tenant_id", ctx.tenantId)
              .eq("vendor_id", vendorId)
              .eq("vendor_ref", vendorRef)
              .neq("status", "voided")
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (!(vendor as any).data) problems.push(`vendor ${vendorId} does not exist in this company`);
      lines.forEach((l, i) => checkAccount(accounts.get(l.account_id), l.account_id, `line ${i + 1}`, problems));
      const existing = ((dupes as any).data ?? []) as any[];
      if (existing.length) {
        problems.push(
          `this supplier already has bill ${existing[0].bill_number} (${existing[0].status}) with reference ${vendorRef} — it is probably a duplicate`,
        );
      }

      if (problems.length) throw new ProposalRejected(problems);

      const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.unit_cost, 0));

      return insertProposal(
        ctx,
        "supplier_bill",
        input,
        {
          vendor_id: vendorId,
          bill_date: billDate,
          due_date: dueDate,
          vendor_ref: vendorRef,
          memo: text(input.memo, 1000) || null,
          lines,
        },
        {
          vendor: (vendor as any).data.name,
          bill_date: billDate,
          vendor_ref: vendorRef,
          subtotal_before_tax: subtotal,
          lines: lines.map((l) => {
            const a = accounts.get(l.account_id);
            return {
              account: `${a.account_code} ${a.account_name}`,
              description: l.description,
              amount: round2(l.qty * l.unit_cost),
              taxed: Boolean(l.tax_code_id || l.tax_group_id),
            };
          }),
        },
      );
    },
  },
];

export const BOOKKEEPING_TOOLS: BookkeepingTool[] = [...reused, ...lookups, ...proposals];

export const BOOKKEEPING_TOOLS_BY_NAME = new Map(BOOKKEEPING_TOOLS.map((t) => [t.name, t]));

export function isProposalTool(name: string): boolean {
  return name.startsWith("propose_");
}

/** Anthropic tool definitions — the `run` functions stay server-side. */
export function bookkeepingToolDefinitions() {
  return BOOKKEEPING_TOOLS.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }));
}
