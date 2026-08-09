// ─────────────────────────────────────────────────────────────────────────────
// Intelligent financial analyst — Claude agent loop over the report RPCs.
//
// The model gets no database access. It gets a fixed set of read-only report
// tools (see _shared/analystTools.ts), each of which runs on a client built
// from the *caller's* JWT, so RLS decides what the answer can contain. The
// tenant is resolved server-side from that JWT and never read from the request
// body: a body-supplied tenant_id is exactly the parameter a prompt injection
// would try to move.
//
// Responses stream as SSE so a question that takes six tool calls shows its
// working instead of spinning for thirty seconds.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.116.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { TOOLS_BY_NAME, toolDefinitions, type ToolContext } from "../_shared/analystTools.ts";
import { embedQuery } from "../_shared/embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-opus-5";
/** Enough for a multi-report answer; low enough that a loop cannot run away. */
const MAX_TOOL_ROUNDS = 12;
/** Trims history so a long conversation cannot grow past the context window. */
const MAX_HISTORY_MESSAGES = 30;

const SYSTEM_PROMPT = `You are the financial analyst for a company using Finthera, an accounting system. You answer questions about this company's finances by querying its actual books.

# How you work

Every number you state must come from a tool result in this conversation. You have no memory of this company's figures and no ability to estimate them. If a tool returns nothing, say the data isn't there — never fill the gap with a plausible number, and never carry a figure forward from an earlier answer without re-checking it.

Start by orienting yourself when the question involves time. "This year", "last quarter" and "recently" depend on the fiscal calendar, so call get_fiscal_context before assuming the fiscal year matches the calendar year.

When the question names something in the company's own words — a project, a supplier, a kind of spend — call search_financial_context first. It turns those words into account IDs and customer IDs, which the report tools need. It returns descriptions and identifiers only, never balances, so always follow a hit with the report tool that computes the figure.

Prefer the tool that matches the question's altitude. get_monthly_summary answers "how did we do last month" in one call; get_trial_balance is for account-level detail; get_financial_statement is for anything phrased the way the published accounts are phrased (gross profit, operating margin, profit for the year).

# Accounting judgement

Account types in this system are exactly: Asset, Liability, Equity, Income, Cost of Goods Sold, Expense, Other Income, Other Expense. "Revenue" and "COGS" are not values here and will match nothing.

Debits and credits are stored raw. Income and liability accounts carry credit balances, so a credit balance on an income account is normal and positive performance. Present figures the way a reader expects them, not the way the ledger stores them.

Flag data-integrity problems rather than answering around them. If get_financial_statement reports integrity_issues, if the trial balance shows a material opening_variance, or if a period you're reporting on is still open, say so as part of the answer — a clean-looking number from an incomplete ledger is worse than a caveated one.

If the company has no budgets, get_budget_vs_actual returns nothing. That means no budget exists, not that performance was on target. The distinction matters and you should make it.

# Your answers

Lead with the answer. The first sentence should be the figure or the finding — what the person would want if they said "just tell me". Supporting detail, method and caveats come after.

Give amounts in LKR with thousands separators, and always say which period they cover. When you compare periods, give both the absolute change and the percentage.

Be a analyst, not a report printer. If expenses rose 40%, say which accounts drove it. If receivables are concentrated in one customer, say so. Volunteer the implication the numbers point to, but keep it to what the numbers actually support — you are reporting on this company's books, not giving investment advice.

Write in prose. Use a small table only when comparing several things on the same dimensions; don't wrap a single figure in a table. Keep it to the length the question needs.

If a question is outside what the books can answer — legal advice, a valuation, something about a different company — say so plainly and offer the nearest thing the ledger can support.`;

interface RequestBody {
  message: string;
  conversation_id?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "The analyst is not configured on this deployment." }, 503);

    // Caller-scoped client. Every tool query runs through this, so RLS is the
    // tenant boundary — not a tenant_id the model or the body supplied.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return json({ error: "Invalid session" }, 401);

    const { data: appUser } = await supabase
      .from("users")
      .select("id, tenant_id")
      .eq("auth_user_id", auth.user.id)
      .maybeSingle();

    if (!appUser?.tenant_id) return json({ error: "No tenant context for this user" }, 403);

    const body: RequestBody = await req.json();
    const question = (body.message ?? "").trim();
    if (!question) return json({ error: "message is required" }, 400);
    if (question.length > 4000) return json({ error: "Question is too long" }, 400);

    // Conversation is created up front so the client has an ID to resume with
    // even if the stream dies mid-answer.
    const conversationId = await ensureConversation(
      supabase,
      appUser.tenant_id,
      appUser.id,
      body.conversation_id ?? null,
      question,
    );

    const history = await loadHistory(supabase, conversationId);

    await supabase.from("analyst_messages").insert({
      conversation_id: conversationId,
      tenant_id: appUser.tenant_id,
      role: "user",
      content: question,
    });

    const ctx: ToolContext = {
      supabase,
      tenantId: appUser.tenant_id,
      embed: embedQuery,
    };

    const stream = runAgent({
      anthropic: new Anthropic({ apiKey }),
      ctx,
      conversationId,
      tenantId: appUser.tenant_id,
      messages: [...history, { role: "user", content: question }],
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Conversation-Id": conversationId,
      },
    });
  } catch (e) {
    console.error("financial-analyst error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

// ── Agent loop ───────────────────────────────────────────────────────────────

function runAgent(opts: {
  anthropic: Anthropic;
  ctx: ToolContext;
  conversationId: string;
  tenantId: string;
  messages: Anthropic.MessageParam[];
}): ReadableStream<Uint8Array> {
  const { anthropic, ctx, conversationId, tenantId } = opts;
  const encoder = new TextEncoder();
  const messages = [...opts.messages];

  return new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      let answer = "";
      const toolTrace: { name: string; input: unknown; ok: boolean }[] = [];
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        send("start", { conversation_id: conversationId });

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          // Streamed rather than awaited whole: tool-heavy turns can run long
          // enough to hit an HTTP idle timeout on a non-streaming request.
          const turn = anthropic.messages.stream({
            model: MODEL,
            // Thinking and the visible answer share this budget, so it is sized
            // for the thinking a multi-report question provokes, not for the
            // couple of paragraphs the user ends up reading.
            max_tokens: 32000,
            thinking: { type: "adaptive" },
            output_config: { effort: "high" },
            system: [
              { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
            ],
            tools: toolDefinitions() as Anthropic.Tool[],
            messages,
          });

          turn.on("text", (delta) => {
            answer += delta;
            send("text", { delta });
          });

          const response = await turn.finalMessage();
          inputTokens += response.usage.input_tokens ?? 0;
          outputTokens += response.usage.output_tokens ?? 0;

          if (response.stop_reason === "refusal") {
            send("error", {
              message:
                "The model declined to answer this question. Try rephrasing it in terms of the reports you need.",
            });
            break;
          }

          // The full content — thinking blocks and all — has to go back
          // verbatim, or the next turn loses the reasoning that led to the
          // tool call it is about to see the result of.
          messages.push({ role: "assistant", content: response.content });

          const toolUses = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          if (toolUses.length === 0) break;

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const call of toolUses) {
            send("tool", { name: call.name, input: call.input });

            const tool = TOOLS_BY_NAME.get(call.name);
            if (!tool) {
              // Reachable if the model hallucinates a tool name. Returning the
              // error to the model lets it correct itself; throwing would end
              // an otherwise-recoverable turn.
              results.push({
                type: "tool_result",
                tool_use_id: call.id,
                content: `No such tool: ${call.name}`,
                is_error: true,
              });
              toolTrace.push({ name: call.name, input: call.input, ok: false });
              continue;
            }

            try {
              const data = await tool.run(call.input as Record<string, any>, ctx);
              results.push({
                type: "tool_result",
                tool_use_id: call.id,
                content: JSON.stringify(data),
              });
              toolTrace.push({ name: call.name, input: call.input, ok: true });
              send("tool_result", { name: call.name, ok: true });
            } catch (e) {
              const message = (e as Error).message;
              console.error(`tool ${call.name} failed`, message);
              results.push({
                type: "tool_result",
                tool_use_id: call.id,
                content: `Error: ${message}`,
                is_error: true,
              });
              toolTrace.push({ name: call.name, input: call.input, ok: false });
              send("tool_result", { name: call.name, ok: false, error: message });
            }
          }

          // All results in one user turn — splitting them teaches the model to
          // stop issuing parallel tool calls.
          messages.push({ role: "user", content: results });

          if (round === MAX_TOOL_ROUNDS - 1) {
            send("error", {
              message:
                "The analyst hit its query limit before finishing. Try asking a narrower question.",
            });
          }
        }

        await ctx.supabase.from("analyst_messages").insert({
          conversation_id: conversationId,
          tenant_id: tenantId,
          role: "assistant",
          content: answer,
          tool_calls: toolTrace,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        });

        send("done", {
          conversation_id: conversationId,
          tools_used: toolTrace.length,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        });
      } catch (e) {
        console.error("agent loop error", e);
        send("error", { message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });
}

// ── Persistence ──────────────────────────────────────────────────────────────

async function ensureConversation(
  supabase: any,
  tenantId: string,
  userId: string,
  existingId: string | null,
  firstQuestion: string,
): Promise<string> {
  if (existingId) {
    // Ownership is enforced by RLS: a conversation belonging to someone else
    // simply isn't visible, so this returns nothing and we start a fresh one
    // rather than appending to a stranger's transcript.
    const { data } = await supabase
      .from("analyst_conversations")
      .select("id")
      .eq("id", existingId)
      .maybeSingle();
    if (data?.id) {
      await supabase
        .from("analyst_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", existingId);
      return data.id;
    }
  }

  const title = firstQuestion.length > 60
    ? `${firstQuestion.slice(0, 57)}...`
    : firstQuestion;

  const { data, error } = await supabase
    .from("analyst_conversations")
    .insert({ tenant_id: tenantId, user_id: userId, title })
    .select("id")
    .single();

  if (error) throw new Error(`Could not start conversation: ${error.message}`);
  return data.id;
}

/** Prior turns as plain text. Tool results are deliberately not replayed —
 *  they are large, and a stale report from an earlier turn is exactly the thing
 *  the model should re-query rather than quote. */
async function loadHistory(
  supabase: any,
  conversationId: string,
): Promise<Anthropic.MessageParam[]> {
  // Newest-first with a limit, then reversed: an ascending limit would keep
  // the *oldest* turns and drop the recent context the follow-up depends on.
  const { data } = await supabase
    .from("analyst_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);

  const rows = (data ?? []).filter((m: any) => m.content?.trim()).reverse();

  // Claude requires the first message to be a user turn; a window that starts
  // on an assistant reply is rejected outright.
  while (rows.length && rows[0].role !== "user") rows.shift();

  return rows.map((m: any) => ({ role: m.role, content: m.content }));
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
