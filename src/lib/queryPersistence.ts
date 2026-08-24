import { get, set, del, keys } from "idb-keyval";
import type { QueryClient } from "@tanstack/react-query";

/**
 * IndexedDB-backed persistence for TanStack Query.
 *
 * On every successful critical-query prefetch, the result is written to
 * IndexedDB keyed by `tq:<serialized-query-key>`. On app startup,
 * `restoreCache()` reads all `tq:*` entries and seeds the QueryClient via
 * `setQueryData()` so the UI can render before the Supabase prefetch burst
 * resolves. Entries older than MAX_AGE_MS are pruned on restore. Tenant
 * isolation comes from the query key itself (`["tenant", tenantId, ...]`),
 * so switching tenants reads a different set of cached entries.
 *
 * Not encrypted — IndexedDB is origin-scoped, and the cached data is
 * reference/read data an authenticated tenant user already has access to.
 * `clearAllCache()` wipes every entry on sign-out so a shared device never
 * shows the next user's cached data.
 */

const IDB_PREFIX = "tq:";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedEntry {
  data: unknown;
  timestamp: number;
  queryKey: unknown[];
}

function serializeKey(queryKey: unknown[]): string {
  return IDB_PREFIX + JSON.stringify(queryKey);
}

/** Persist a single query result to IndexedDB. */
export async function persistQuery(queryKey: unknown[], data: unknown): Promise<void> {
  try {
    const entry: CachedEntry = { data, timestamp: Date.now(), queryKey };
    await set(serializeKey(queryKey), entry);
  } catch (err) {
    // IndexedDB can fail (private browsing, storage full) — fail silently.
    console.warn("[QueryPersistence] Failed to persist:", err);
  }
}

/**
 * Restore all cached queries into the QueryClient on app startup.
 * Call this BEFORE the Supabase prefetch burst so the UI has data to
 * render while the network catches up. Returns the number restored.
 */
export async function restoreCache(queryClient: QueryClient): Promise<number> {
  try {
    const allKeys = await keys<string>();
    const tqKeys = allKeys.filter((k) => typeof k === "string" && k.startsWith(IDB_PREFIX));
    if (tqKeys.length === 0) return 0;

    const now = Date.now();
    let restored = 0;
    const staleKeys: string[] = [];

    const entries = await Promise.all(
      tqKeys.map(async (key) => ({ key, entry: await get<CachedEntry>(key) }))
    );

    for (const { key, entry } of entries) {
      if (!entry || !entry.queryKey || entry.data === undefined) {
        staleKeys.push(key);
        continue;
      }
      if (now - entry.timestamp > MAX_AGE_MS) {
        staleKeys.push(key);
        continue;
      }
      queryClient.setQueryData(entry.queryKey, entry.data, { updatedAt: entry.timestamp });
      restored++;
    }

    if (staleKeys.length > 0) {
      Promise.all(staleKeys.map((k) => del(k))).catch(() => {});
    }

    return restored;
  } catch (err) {
    // IndexedDB unavailable — proceed without cache.
    console.warn("[QueryPersistence] Restore failed:", err);
    return 0;
  }
}

/** Clear every cached entry, across all tenants. Call on sign-out. */
export async function clearAllCache(): Promise<void> {
  try {
    const allKeys = await keys<string>();
    const tqKeys = allKeys.filter((k) => typeof k === "string" && k.startsWith(IDB_PREFIX));
    await Promise.all(tqKeys.map((k) => del(k)));
  } catch (err) {
    console.warn("[QueryPersistence] Clear failed:", err);
  }
}
