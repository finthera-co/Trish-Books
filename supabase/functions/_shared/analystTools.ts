// ─────────────────────────────────────────────────────────────────────────────
// The financial analyst's tool surface.
//
// Every tool here is read-only and runs on the *caller's* Supabase client, not
// the service role — so RLS is the tenant boundary rather than a tenant_id the
// model was trusted to pass correctly. A prompt injection that talks the model
// into asking for another tenant's trial balance gets that tenant's empty set.
//
// There is deliberately no free-SQL tool. Every number the analyst can quote
// comes from a report RPC the rest of the app already renders on screen, so an
// answer here and the Trial Balance page cannot disagree.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface ToolContext {
  /** Caller-scoped client — RLS applies. */
  supabase: SupabaseClient;
  tenantId: string;
  /** Embeds a search query for the retrieval tool. */
  embed: (text: string) => Promise<number[]>;
}

export interface AnalystTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (input: Record<string, any>, ctx: ToolContext) => Promise<unknown>;
}

/** Report payloads get large; a truncated array is better than a 400. */
function cap<T>(rows: T[] | null, limit: number): T[] {
  return (rows ?? []).slice(0, limit);
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Fails loudly rather than returning [] — a silent empty set reads to the
 *  model as "no such transactions", which is a wrong answer, not a missing one. */
function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} failed: ${res.error.message}`);
  return (res.data ?? []) as T;
}

const DATE = { type: "string", description: "ISO date, YYYY-MM-DD" };

export const ANALYST_TOOLS: AnalystTool[] = [
  // ── Retrieval ──────────────────────────────────────────────────────────────
  {
    name: "search_financial_context",
    description:
      "Semantic search across this company's chart of accounts, journal entry narrations, " +
      "invoice and bill line descriptions, customers and vendors. Use this FIRST whenever the " +
      "question names something in the company's own words rather than an exact account code — " +
      "\"marketing consultants\", \"the Colombo warehouse lease\", \"that big refund to Ceylon Traders\". " +
      "Returns the matching records with their IDs and codes, which you then pass to the report " +
      "tools. This tool returns identifiers and descriptions only: it never returns balances, so " +
      "always follow a hit with the report tool that computes the actual figure.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language description of what to find. Paraphrase freely.",
        },
        source_types: {
          type: "array",
          items: {
            type: "string",
            enum: ["account", "journal_entry", "invoice_line", "bill_line", "customer", "vendor"],
          },
          description: "Restrict to these record kinds. Omit to search everything.",
        },
        limit: { type: "integer", description: "Max results, 1-50. Default 12." },
      },
      required: ["query"],
    },
    async run(input, ctx) {
      const embedding = await ctx.embed(String(input.query));
      const rows = unwrap(
        await ctx.supabase.rpc("analyst_search", {
          p_query_embedding: JSON.stringify(embedding),
          p_source_types: input.source_types ?? null,
          p_limit: Math.min(50, Math.max(1, Number(input.limit) || 12)),
        }),
        "search_financial_context",
      ) as any[];

      return {
        matches: rows.map((r) => ({
          type: r.source_type,
          id: r.source_id,
          text: r.content,
          ...r.metadata,
          similarity: Number(r.similarity?.toFixed?.(3) ?? r.similarity),
        })),
        note: rows.length === 0
          ? "No indexed records matched. The retrieval index may still be building — " +
            "fall back to list_accounts and filter by name."
          : undefined,
      };
    },
  },

  // ── Core statements ────────────────────────────────────────────────────────
  {
    name: "get_trial_balance",
    description:
      "The trial balance for a date range: every account with its opening balance, period debits " +
      "and credits, and closing balance. This is the ground truth for 'what is the balance of X' " +
      "and for any question that needs several accounts at once. Also reports opening_variance, " +
      "which is non-zero when the ledger disagrees with the audited opening figure — mention it " +
      "if it is material.",
    input_schema: {
      type: "object",
      properties: {
        date_from: DATE,
        date_to: DATE,
        group_by: {
          type: "string",
          enum: ["parent", "type", "none"],
          description: "How to band the rows. Default 'parent'.",
        },
        include_zero: {
          type: "boolean",
          description: "Include accounts with no movement and no balance. Default false.",
        },
      },
      required: ["date_from", "date_to"],
    },
    async run(input, ctx) {
      const rows = unwrap(
        await ctx.supabase.rpc("rpc_trial_balance", {
          p_date_from: input.date_from,
          p_date_to: input.date_to,
          p_group_by: input.group_by ?? "parent",
          p_include_zero: input.include_zero ?? false,
          p_include_inactive: true,
        }),
        "get_trial_balance",
      ) as any[];

      return {
        period: { from: input.date_from, to: input.date_to },
        accounts: cap(
          rows.map((r) => ({
            group: r.group_label,
            code: r.account_code,
            name: r.account_name,
            type: r.account_type,
            opening: num(r.ledger_opening),
            debit: num(r.period_debit),
            credit: num(r.period_credit),
            closing: num(r.closing),
            opening_variance: num(r.opening_variance) || undefined,
            account_id: r.account_id,
          })),
          400,
        ),
        truncated: rows.length > 400,
      };
    },
  },
  {
    name: "list_financial_statements",
    description:
      "List the formatted financial statements configured for this company (income statement, " +
      "balance sheet, etc.) with their codes. Call this before get_financial_statement so you use " +
      "a code that exists — statement codes are per-company, not fixed.",
    input_schema: { type: "object", properties: {} },
    async run(_input, ctx) {
      const res = await ctx.supabase
        .from("fs_statements")
        .select("code, name, title, period_caption, currency_caption")
        .order("sort_order");
      return { statements: unwrap(res as any, "list_financial_statements") };
    },
  },
  {
    name: "get_financial_statement",
    description:
      "A presentation-ready financial statement (income statement / statement of comprehensive " +
      "income and any other configured statement) with subtotals, margins and an optional " +
      "comparative period. Prefer this over get_trial_balance when the question is about the " +
      "statement as published — gross profit, operating margin, profit for the year — because it " +
      "applies the company's own line mapping and formulas.",
    input_schema: {
      type: "object",
      properties: {
        statement_code: {
          type: "string",
          description: "Code from list_financial_statements.",
        },
        date_from: DATE,
        date_to: DATE,
        compare_date_from: { ...DATE, description: "Optional comparative period start." },
        compare_date_to: { ...DATE, description: "Optional comparative period end." },
      },
      required: ["statement_code", "date_from", "date_to"],
    },
    async run(input, ctx) {
      const rows = unwrap(
        await ctx.supabase.rpc("rpc_fs_statement", {
          p_statement_code: input.statement_code,
          p_date_from: input.date_from,
          p_date_to: input.date_to,
          p_cmp_date_from: input.compare_date_from ?? null,
          p_cmp_date_to: input.compare_date_to ?? null,
        }),
        "get_financial_statement",
      ) as any[];

      // Coverage is fetched alongside because an unmapped account silently
      // drops revenue out of the statement — an answer built on a statement
      // with an UNMAPPED_ACCOUNT error is wrong and the model must say so.
      const coverage = (await ctx.supabase.rpc("rpc_fs_coverage", {
        p_statement_code: input.statement_code,
        p_date_from: input.date_from,
        p_date_to: input.date_to,
      })).data as any[] | null;

      return {
        period: { from: input.date_from, to: input.date_to },
        lines: rows
          .filter((r) => r.line_type !== "spacer")
          .map((r) => ({
            label: r.label,
            value: r.current_value == null ? null : num(r.current_value),
            comparative: r.compare_value == null ? null : num(r.compare_value),
            margin_pct: r.current_margin == null ? null : num(r.current_margin),
            emphasis: r.emphasis,
          })),
        integrity_issues: (coverage ?? [])
          .filter((c) => c.severity === "error")
          .map((c) => ({ issue: c.issue_code, detail: c.detail, amount: num(c.amount) })),
      };
    },
  },

  // ── Balances and movement ──────────────────────────────────────────────────
  {
    name: "get_account_balances",
    description:
      "Aggregate debit and credit per account over a date range. Cheaper and flatter than the " +
      "trial balance — use it for totals by account type (total income, total expenses) or when " +
      "you need every account's movement without opening balances.",
    input_schema: {
      type: "object",
      properties: {
        date_from: DATE,
        date_to: DATE,
        account_types: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter to these account types. Valid values are exactly: Asset, Liability, Equity, " +
            "Income, Cost of Goods Sold, Expense, Other Income, Other Expense. Note it is " +
            "'Income' and 'Cost of Goods Sold' — 'Revenue' and 'COGS' match nothing.",
        },
      },
      required: ["date_from", "date_to"],
    },
    async run(input, ctx) {
      const rows = unwrap(
        await ctx.supabase.rpc("gl_account_balances", {
          p_from: input.date_from,
          p_to: input.date_to,
        }),
        "get_account_balances",
      ) as any[];

      const types: string[] | null = input.account_types ?? null;
      const filtered = types ? rows.filter((r) => types.includes(r.account_type)) : rows;

      return {
        period: { from: input.date_from, to: input.date_to },
        accounts: cap(
          filtered.map((r) => ({
            account_id: r.account_id,
            code: r.account_code,
            name: r.account_name,
            type: r.account_type,
            debit: num(r.debit),
            credit: num(r.credit),
            net: num(r.debit) - num(r.credit),
          })),
          400,
        ),
      };
    },
  },
  {
    name: "get_monthly_movements",
    description:
      "Month-by-month debits and credits per account. This is the tool for trends, run rates, " +
      "seasonality and any 'how has X changed over time' question. Filter to a few accounts when " +
      "you can — an unfiltered year across a large chart of accounts is a lot of rows.",
    input_schema: {
      type: "object",
      properties: {
        date_from: DATE,
        date_to: DATE,
        account_ids: {
          type: "array",
          items: { type: "string" },
          description: "Restrict to these account IDs (from search or list_accounts).",
        },
        account_types: { type: "array", items: { type: "string" } },
      },
      required: ["date_from", "date_to"],
    },
    async run(input, ctx) {
      const rows = unwrap(
        await ctx.supabase.rpc("gl_monthly_account_movements", {
          p_from: input.date_from,
          p_to: input.date_to,
        }),
        "get_monthly_movements",
      ) as any[];

      const ids: string[] | null = input.account_ids ?? null;
      const types: string[] | null = input.account_types ?? null;
      const filtered = rows.filter(
        (r) =>
          (!ids || ids.includes(r.account_id)) &&
          (!types || types.includes(r.account_type)),
      );

      return {
        months: cap(
          filtered.map((r) => ({
            month: r.month,
            code: r.account_code,
            name: r.account_name,
            type: r.account_type,
            debit: num(r.debit),
            credit: num(r.credit),
            net: num(r.debit) - num(r.credit),
          })),
          1000,
        ),
        truncated: filtered.length > 1000,
      };
    },
  },
  {
    name: "get_account_ledger",
    description:
      "Individual transactions posted to one account, newest first, with dates, descriptions, " +
      "references and a running balance. Use this to explain a balance — which entries make it up, " +
      "what the largest ones were, whether something looks like a one-off.",
    input_schema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Account UUID." },
        date_from: DATE,
        date_to: DATE,
        search: { type: "string", description: "Optional text filter on description/reference." },
        limit: { type: "integer", description: "Max rows, 1-200. Default 50." },
      },
      required: ["account_id"],
    },
    async run(input, ctx) {
      const rows = unwrap(
        await ctx.supabase.rpc("account_ledger_page", {
          p_account_id: input.account_id,
          p_date_from: input.date_from ?? null,
          p_date_to: input.date_to ?? null,
          p_search: input.search ?? null,
          p_entry_type: null,
          p_txn_type: null,
          p_sort: "date",
          p_sort_dir: "desc",
          p_limit: Math.min(200, Math.max(1, Number(input.limit) || 50)),
          p_offset: 0,
        }),
        "get_account_ledger",
      ) as any[];

      return {
        // The RPC returns cumulative debit/credit rather than a signed running
        // balance; netting them here saves the model from having to know the
        // account's normal balance to interpret the pair.
        transactions: rows.map((r) => ({
          date: r.entry_date,
          description: r.description,
          reference: r.reference,
          type: r.txn_type ?? r.entry_type,
          debit: num(r.debit),
          credit: num(r.credit),
          running_balance: num(r.cum_debit) - num(r.cum_credit),
          voided: r.voided_at != null || undefined,
          entry_id: r.entry_id,
        })),
        total_matching_rows: rows.length ? Number(rows[0].filtered_rows ?? rows.length) : 0,
      };
    },
  },
  {
    name: "list_accounts",
    description:
      "The chart of accounts — codes, names, types, active flag. Use it to resolve an account when " +
      "semantic search returns nothing, or to see how the chart is organised before answering a " +
      "structural question.",
    input_schema: {
      type: "object",
      properties: {
        name_contains: { type: "string", description: "Case-insensitive substring filter." },
        account_types: { type: "array", items: { type: "string" } },
        postable_only: {
          type: "boolean",
          description: "Only accounts that can be posted to (excludes headers). Default true.",
        },
      },
    },
    async run(input, ctx) {
      let q = ctx.supabase
        .from("accounts")
        .select("id, account_code, account_name, account_type, account_subtype, is_active, is_postable")
        .eq("tenant_id", ctx.tenantId)
        .order("account_code")
        .limit(500);

      if (input.postable_only !== false) q = q.eq("is_postable", true);
      if (input.name_contains) q = q.ilike("account_name", `%${input.name_contains}%`);
      if (input.account_types?.length) q = q.in("account_type", input.account_types);

      const rows = unwrap(await q as any, "list_accounts") as any[];
      return {
        accounts: rows.map((r) => ({
          account_id: r.id,
          code: r.account_code,
          name: r.account_name,
          type: r.account_type,
          subtype: r.account_subtype,
          active: r.is_active,
        })),
      };
    },
  },

  // ── Working capital ────────────────────────────────────────────────────────
  {
    name: "get_receivables_aging",
    description:
      "Accounts receivable aged by bucket (current, 1-30, 31-60, 61-90, 91-120, 120+) per customer, " +
      "as at a date. The tool for 'who owes us', collection risk and DSO-shaped questions.",
    input_schema: {
      type: "object",
      properties: { as_of_date: { ...DATE, description: "Defaults to today." } },
    },
    async run(input, ctx) {
      const res = await ctx.supabase.rpc("ar_aging_report", {
        p_as_of_date: input.as_of_date ?? new Date().toISOString().slice(0, 10),
      });
      if (res.error) throw new Error(`get_receivables_aging failed: ${res.error.message}`);
      return res.data ?? { customers: [] };
    },
  },
  {
    name: "get_payables_aging",
    description:
      "Accounts payable aged by bucket per vendor, as at a date. The tool for 'who do we owe', " +
      "upcoming payment pressure and supplier concentration.",
    input_schema: {
      type: "object",
      properties: { as_of_date: { ...DATE, description: "Defaults to today." } },
    },
    async run(input, ctx) {
      const res = await ctx.supabase.rpc("ap_aging_report", {
        p_as_of_date: input.as_of_date ?? new Date().toISOString().slice(0, 10),
      });
      if (res.error) throw new Error(`get_payables_aging failed: ${res.error.message}`);
      return res.data ?? { vendors: [] };
    },
  },
  {
    name: "get_cash_position",
    description:
      "Daily closing cash and bank balance over a date range. Use it for runway, burn rate and " +
      "'how much cash do we have' questions. Derive burn from the trend rather than assuming it.",
    input_schema: {
      type: "object",
      properties: {
        date_from: DATE,
        date_to: DATE,
      },
      required: ["date_from", "date_to"],
    },
    async run(input, ctx) {
      const rows = unwrap(
        await ctx.supabase
          .from("daily_balances")
          .select("date, closing_balance")
          .eq("tenant_id", ctx.tenantId)
          .gte("date", input.date_from)
          .lte("date", input.date_to)
          .order("date", { ascending: true })
          .limit(1000) as any,
        "get_cash_position",
      ) as any[];

      return {
        days: rows.map((r) => ({ date: r.date, closing_balance: num(r.closing_balance) })),
        latest: rows.length ? num(rows[rows.length - 1].closing_balance) : null,
      };
    },
  },
  {
    name: "get_monthly_summary",
    description:
      "Pre-aggregated total income, total expense and net profit per month. The fastest way to " +
      "answer 'how did we do last month/quarter/year' and to spot the months worth drilling into.",
    input_schema: {
      type: "object",
      properties: {
        months: { type: "integer", description: "How many recent months. Default 12, max 60." },
      },
    },
    async run(input, ctx) {
      const limit = Math.min(60, Math.max(1, Number(input.months) || 12));
      const rows = unwrap(
        await ctx.supabase
          .from("monthly_financials")
          .select("month, total_income, total_expense, net")
          .eq("tenant_id", ctx.tenantId)
          .order("month", { ascending: false })
          .limit(limit) as any,
        "get_monthly_summary",
      ) as any[];

      return {
        months: rows
          .map((r) => ({
            month: r.month,
            income: num(r.total_income),
            expense: num(r.total_expense),
            net: num(r.net),
          }))
          .reverse(),
      };
    },
  },
  {
    name: "get_budget_vs_actual",
    description:
      "Budgeted versus actual amounts per account for a fiscal year, with variances. Only useful " +
      "if the company has budgets configured — an empty result means no budget exists, not that " +
      "performance was on target. Say which it is.",
    input_schema: {
      type: "object",
      properties: {
        fiscal_year: { type: "integer", description: "e.g. 2026. Defaults to the current year." },
        account_type: { type: "string", description: "Optional filter, e.g. 'Expense'." },
      },
    },
    async run(input, ctx) {
      const rows = unwrap(
        await ctx.supabase.rpc("budget_vs_actual", {
          p_tenant_id: ctx.tenantId,
          p_fiscal_year: input.fiscal_year ?? new Date().getFullYear(),
          p_department_id: null,
          p_account_type: input.account_type ?? null,
        }),
        "get_budget_vs_actual",
      ) as any[];

      return {
        has_budget: rows.length > 0,
        lines: cap(rows, 300),
      };
    },
  },
  {
    name: "get_customer_statement",
    description:
      "One customer's full account: invoices, payments, credit notes and running balance over a " +
      "period. Use it after semantic search resolves a customer name to an ID.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        date_from: DATE,
        date_to: DATE,
      },
      required: ["customer_id", "date_from", "date_to"],
    },
    async run(input, ctx) {
      const res = await ctx.supabase.rpc("get_customer_statement", {
        p_customer_id: input.customer_id,
        p_from: input.date_from,
        p_to: input.date_to,
      });
      if (res.error) throw new Error(`get_customer_statement failed: ${res.error.message}`);
      return res.data ?? {};
    },
  },
  {
    name: "get_inventory_valuation",
    description:
      "Stock on hand per item with FIFO and weighted-average valuations. Use for inventory value, " +
      "slow-moving stock and any question about what is sitting in the warehouse.",
    input_schema: { type: "object", properties: {} },
    async run(_input, ctx) {
      const rows = unwrap(
        await ctx.supabase.rpc("inventory_valuation_report", { p_tenant_id: ctx.tenantId }),
        "get_inventory_valuation",
      ) as any[];

      return {
        items: cap(
          rows.map((r) => ({
            code: r.item_code,
            name: r.item_name,
            qty_on_hand: num(r.qty_on_hand),
            unit_cost: num(r.unit_cost),
            value: num(r.reported_value),
            method: r.valuation_method,
          })),
          300,
        ),
        total_value: rows.reduce((s, r) => s + num(r.reported_value), 0),
      };
    },
  },
  {
    name: "get_fiscal_context",
    description:
      "Today's date, the company's fiscal periods and which ones are closed, plus the reporting " +
      "currency. Call this before any question that says 'this year', 'last quarter' or 'recently' " +
      "— do not assume the fiscal year is the calendar year.",
    input_schema: { type: "object", properties: {} },
    async run(_input, ctx) {
      const [periods, tenant] = await Promise.all([
        ctx.supabase
          .from("fiscal_periods")
          .select("name, period_start, period_end, status")
          .eq("tenant_id", ctx.tenantId)
          .order("period_start", { ascending: false })
          .limit(24),
        ctx.supabase
          .from("tenants")
          .select("company_name, country")
          .eq("id", ctx.tenantId)
          .maybeSingle(),
      ]);

      return {
        today: new Date().toISOString().slice(0, 10),
        company: (tenant.data as any)?.company_name ?? null,
        country: (tenant.data as any)?.country ?? null,
        // Functional currency is LKR throughout the ledger; per-document
        // currencies are FX-translated before posting.
        reporting_currency: "LKR",
        fiscal_periods: (periods.data ?? []).map((p: any) => ({
          name: p.name,
          start: p.period_start,
          end: p.period_end,
          status: p.status,
        })),
      };
    },
  },
];

export const TOOLS_BY_NAME = new Map(ANALYST_TOOLS.map((t) => [t.name, t]));

/** Anthropic tool definitions — the `run` functions stay server-side. */
export function toolDefinitions() {
  return ANALYST_TOOLS.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }));
}
