// ─────────────────────────────────────────────────────────────────────────────
// Embedding provider.
//
// Anthropic has no embeddings endpoint, so the vectors come from Voyage — the
// one external dependency the analyst has beyond Claude itself. Everything that
// knows the provider lives in this file: the dimension is pinned in the
// migration (vector(1024)) and referenced here, so swapping providers is this
// file plus one ALTER TYPE, not a search across the codebase.
//
// `input_type` matters and is easy to get wrong: Voyage embeds a stored
// document and a search query into deliberately different regions of the space.
// Indexing with "query" (or searching with "document") degrades recall quietly
// — nothing errors, results are just worse.
// ─────────────────────────────────────────────────────────────────────────────

/** Must match `vector(1024)` in the analyst_documents migration. */
export const EMBEDDING_DIM = 1024;

const MODEL = "voyage-3.5-lite";
const ENDPOINT = "https://api.voyageai.com/v1/embeddings";

/** Voyage caps a request at 1000 inputs; stay well under to bound latency. */
export const MAX_BATCH = 96;

export class EmbeddingError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "EmbeddingError";
  }
}

async function callVoyage(
  texts: string[],
  inputType: "document" | "query",
): Promise<number[][]> {
  const key = Deno.env.get("VOYAGE_API_KEY");
  if (!key) throw new EmbeddingError("VOYAGE_API_KEY is not configured", 500);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: texts,
      input_type: inputType,
      output_dimension: EMBEDDING_DIM,
      truncation: true,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new EmbeddingError(
      `Voyage returned ${res.status}: ${detail.slice(0, 300)}`,
      res.status,
    );
  }

  const body = await res.json();
  const vectors: number[][] = (body.data ?? [])
    // The API is documented to preserve input order, but an out-of-order
    // response would silently attach every embedding to the wrong record —
    // a failure no test would catch. Sorting by index costs nothing.
    .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
    .map((d: any) => d.embedding as number[]);

  if (vectors.length !== texts.length) {
    throw new EmbeddingError(
      `Voyage returned ${vectors.length} embeddings for ${texts.length} inputs`,
    );
  }
  return vectors;
}

/** Embeds a batch of documents for storage. Retries transient failures. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > MAX_BATCH) {
    throw new EmbeddingError(`Batch of ${texts.length} exceeds MAX_BATCH ${MAX_BATCH}`);
  }
  return await withRetry(() => callVoyage(texts, "document"));
}

/** Embeds a single search query. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await withRetry(() => callVoyage([text], "query"));
  return vector;
}

/** Rate limits and 5xx are expected on a batch backfill; 4xx is a bug. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const status = e instanceof EmbeddingError ? e.status : undefined;
      const retryable = status === 429 || (status !== undefined && status >= 500) || status === undefined;
      if (!retryable || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastError;
}
