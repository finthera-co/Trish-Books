import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { describeError } from "@/lib/errorMessage";

// The analyst streams its answer as Server-Sent Events, which supabase-js's
// functions.invoke() cannot surface — it buffers the whole body. So this hook
// calls the function endpoint with fetch directly and parses the event stream,
// attaching the session token the same way invoke() would.

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export interface AnalystToolCall {
  name: string;
  input: Record<string, unknown>;
  status: "running" | "done" | "failed";
  error?: string;
}

export interface AnalystMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: AnalystToolCall[];
  /** Set while this message is still being streamed. */
  streaming?: boolean;
}

/** Human-readable label for a tool, so the progress line reads like a sentence
 *  rather than an API trace. */
const TOOL_LABELS: Record<string, string> = {
  search_financial_context: "Searching your records",
  get_trial_balance: "Reading the trial balance",
  list_financial_statements: "Listing statements",
  get_financial_statement: "Reading the financial statements",
  get_account_balances: "Totalling account balances",
  get_monthly_movements: "Analysing monthly movements",
  get_account_ledger: "Opening the account ledger",
  list_accounts: "Reading the chart of accounts",
  get_receivables_aging: "Ageing receivables",
  get_payables_aging: "Ageing payables",
  get_cash_position: "Checking the cash position",
  get_monthly_summary: "Summarising recent months",
  get_budget_vs_actual: "Comparing budget to actual",
  get_customer_statement: "Reading the customer statement",
  get_inventory_valuation: "Valuing inventory",
  get_fiscal_context: "Checking the fiscal calendar",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

/** Union of every `data:` body the function emits, flattened — the event name
 *  already discriminates, so the fields are optional rather than per-variant. */
interface StreamPayload {
  conversation_id?: string;
  delta?: string;
  name?: string;
  input?: Record<string, unknown>;
  ok?: boolean;
  error?: string;
  message?: string;
}

export function useFinancialAnalyst() {
  const [messages, setMessages] = useState<AnalystMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const conversationId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const patchLast = useCallback((fn: (m: AnalystMessage) => AnalystMessage) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || isStreaming) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content: trimmed, toolCalls: [] },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          toolCalls: [],
          streaming: true,
        },
      ]);
      setIsStreaming(true);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error("Your session has expired. Sign in again.");

        const res = await fetch(`${FUNCTIONS_URL}/financial-analyst`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            message: trimmed,
            conversation_id: conversationId.current,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          // Errors before the stream opens come back as plain JSON.
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.error ?? `The analyst is unavailable (${res.status}).`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line. A frame split across
          // chunks stays in the buffer until its terminator arrives.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const event = frame.match(/^event: (.+)$/m)?.[1];
            const raw = frame.match(/^data: (.+)$/m)?.[1];
            if (!event || !raw) continue;

            let payload: StreamPayload;
            try {
              payload = JSON.parse(raw) as StreamPayload;
            } catch {
              continue;
            }

            switch (event) {
              case "start":
                conversationId.current = payload.conversation_id;
                break;

              case "text":
                patchLast((m) => ({ ...m, content: m.content + payload.delta }));
                break;

              case "tool":
                patchLast((m) => ({
                  ...m,
                  toolCalls: [
                    ...m.toolCalls,
                    { name: payload.name, input: payload.input ?? {}, status: "running" },
                  ],
                }));
                break;

              case "tool_result":
                patchLast((m) => {
                  const calls = [...m.toolCalls];
                  // The last still-running call with this name is the one that
                  // just returned; the model can call the same tool twice in
                  // one turn, so name alone is not a key.
                  for (let i = calls.length - 1; i >= 0; i--) {
                    if (calls[i].name === payload.name && calls[i].status === "running") {
                      calls[i] = {
                        ...calls[i],
                        status: payload.ok ? "done" : "failed",
                        error: payload.error,
                      };
                      break;
                    }
                  }
                  return { ...m, toolCalls: calls };
                });
                break;

              case "error":
                toast.error(payload.message);
                patchLast((m) => ({
                  ...m,
                  content: m.content || `I couldn't finish that: ${payload.message}`,
                }));
                break;

              case "done":
                patchLast((m) => ({ ...m, streaming: false }));
                break;
            }
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          patchLast((m) => ({ ...m, streaming: false }));
          return;
        }
        const message = describeError(e);
        toast.error(message);
        patchLast((m) => ({
          ...m,
          streaming: false,
          content: m.content || `I couldn't answer that: ${message}`,
        }));
      } finally {
        setIsStreaming(false);
        patchLast((m) => ({ ...m, streaming: false }));
      }
    },
    [isStreaming, patchLast],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    conversationId.current = null;
    setMessages([]);
  }, []);

  return { messages, ask, stop, reset, isStreaming };
}

interface AnalystIndexRow {
  total_documents: number | string;
  embedded_documents: number | string;
  pending_queue: number | string;
  last_indexed_at: string | null;
}

interface ReindexResult {
  embedded?: number;
  pending?: number;
}

/** Index coverage — the analyst's semantic search only sees embedded rows, so
 *  a partially built index means degraded answers and the UI should say so. */
export function useAnalystIndexStatus() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["analyst_index_status", appUser?.tenant_id],
    enabled: Boolean(appUser?.tenant_id),
    queryFn: async () => {
      // Not in the generated types until `supabase gen types` is re-run.
      const { data, error } = await supabase.rpc(
        "analyst_index_status" as never,
      );
      if (error) throw error;
      const row = (data as AnalystIndexRow[] | null)?.[0];
      return {
        total: Number(row?.total_documents ?? 0),
        embedded: Number(row?.embedded_documents ?? 0),
        pending: Number(row?.pending_queue ?? 0),
        lastIndexedAt: row?.last_indexed_at as string | null,
      };
    },
    staleTime: 30_000,
    refetchInterval: (query) => {
      const d = query.state.data;
      // Poll while a build is in flight, then stop.
      return d && d.embedded < d.total ? 5_000 : false;
    },
  });
}

/**
 * Pulls the real reason out of a functions.invoke() failure.
 *
 * supabase-js reports every non-2xx as the same sentence — "Edge Function
 * returned a non-2xx status code" — and hides the response on `error.context`.
 * The body is where the actionable text lives ("VOYAGE_API_KEY is not
 * configured"), so without this the user is told only that something failed.
 */
async function functionErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown }).context;

  if (context instanceof Response) {
    try {
      // The body can only be read once, so work on a clone — supabase-js may
      // have already consumed the original.
      const body = await context.clone().json();
      if (typeof body?.error === "string") return body.error;
    } catch {
      // Not JSON (a gateway HTML error page, say) — fall through.
    }
    if (context.status === 404) {
      return "The analyst-reindex function isn't deployed to this project yet.";
    }
    return `The indexer returned ${context.status}.`;
  }

  return describeError(error);
}

export function useBuildAnalystIndex() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const [isBuilding, setIsBuilding] = useState(false);

  const build = useCallback(async () => {
    if (!appUser?.tenant_id || isBuilding) return;
    setIsBuilding(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyst-reindex", {
        body: { mode: "full", tenant_id: appUser.tenant_id },
      });
      if (error) throw new Error(await functionErrorMessage(error));

      const result = (data as { results?: ReindexResult[] } | null)?.results?.[0];
      const pending = Number(result?.pending ?? 0);
      toast.success(
        pending > 0
          ? `Indexed ${result?.embedded ?? 0} records — ${pending} still to go. Run it again to continue.`
          : `Index up to date (${result?.embedded ?? 0} records embedded).`,
      );
      queryClient.invalidateQueries({ queryKey: ["analyst_index_status"] });
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setIsBuilding(false);
    }
  }, [appUser?.tenant_id, isBuilding, queryClient]);

  return { build, isBuilding };
}
