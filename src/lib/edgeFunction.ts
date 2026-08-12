import { supabase } from "@/integrations/supabase/client";

/**
 * Thrown when an edge function replies 429.
 *
 * supabase.functions.invoke() does not surface a non-2xx body directly — it
 * wraps the response in a FunctionsHttpError whose body is only reachable via
 * error.context. Without this, every caller's catch block reports a generic
 * "Edge function call failed" and the retry_after we send back is thrown away.
 */
export class RateLimitError extends Error {
  constructor(public retryAfter: number) {
    super(
      `You're going a bit fast. Please wait ${retryAfter}s and try again.`,
    );
    this.name = "RateLimitError";
  }
}

/**
 * A non-2xx that carried a JSON body. `payload` is kept so call sites that need
 * structured detail (validate-journal-entry returns 422 with an `errors` array)
 * can still reach it instead of only getting a flattened message.
 */
export class EdgeFunctionError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload: unknown,
  ) {
    super(message);
    this.name = "EdgeFunctionError";
  }
}

export async function invokeEdgeFunction<T = unknown>(
  name: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(
    name,
    body === undefined ? undefined : { body },
  );

  if (error) {
    const ctx = (error as { context?: unknown }).context;

    if (ctx instanceof Response) {
      // The body is a one-shot stream and supabase-js may already have read the
      // original, so always work on a clone.
      let payload: { error?: unknown; retry_after?: unknown } | null = null;
      try {
        payload = await ctx.clone().json();
      } catch {
        /* not JSON (a gateway HTML error page, say) — fall through */
      }

      if (ctx.status === 429) {
        throw new RateLimitError(Number(payload?.retry_after) || 60);
      }

      // supabase-js reports every non-2xx as the same sentence ("Edge Function
      // returned a non-2xx status code") and hides the real reason on the
      // response body, so surface that when it is there.
      if (typeof payload?.error === "string") {
        throw new EdgeFunctionError(payload.error, ctx.status, payload);
      }
      if (ctx.status === 404) {
        throw new EdgeFunctionError(
          `${name} is not deployed to this project.`,
          404,
          payload,
        );
      }
      throw new EdgeFunctionError(`${name} returned ${ctx.status}.`, ctx.status, payload);
    }

    throw new Error(error.message || `${name} failed`);
  }

  // Several of these functions report failure in a 200 body rather than a
  // non-2xx status, so an ok-looking response still has to be checked.
  if ((data as { error?: string })?.error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}
