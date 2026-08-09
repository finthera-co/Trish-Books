import { useCallback, useEffect, useRef, useState } from "react";

const DRAFT_PREFIX = "finthera:draft";
const DRAFT_VERSION = "v1"; // bump to invalidate all old drafts after a shape change

function makeKey(page: string, scope?: string) {
  return `${DRAFT_PREFIX}:${DRAFT_VERSION}:${page}${scope ? ":" + scope : ""}`;
}
function safeGet<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; }
  catch { return null; }
}
function safeSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / unavailable */ }
}
function safeRemove(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// Remove every Trish Books draft (call on sign-out — see 11.4).
export function clearAllFintheraDrafts() {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

export function useDraftPersistence<T>(opts: {
  page: string;            // stable id for this screen, e.g. "biometric-linking"
  scope?: string;          // tenant+user, e.g. `${tenant_id}:${user_id}` — keeps drafts private per user
  initial: T;
  debounceMs?: number;
}) {
  const key = makeKey(opts.page, opts.scope);

  // Read storage exactly once at mount.
  const initRef = useRef<{ value: T; restored: boolean } | null>(null);
  if (initRef.current === null) {
    const restored = safeGet<T>(key);
    initRef.current = { value: restored ?? opts.initial, restored: restored != null };
  }

  const [value, setValue] = useState<T>(initRef.current.value);
  const [wasRestored, setWasRestored] = useState<boolean>(initRef.current.restored);

  // Keep a ref of the latest value so pagehide can flush synchronously.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Debounced write on change.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => safeSet(key, value), opts.debounceMs ?? 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [key, value, opts.debounceMs]);

  // Flush immediately on tab hide / refresh / close, so the last keystroke is never lost.
  useEffect(() => {
    const flush = () => safeSet(key, valueRef.current);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [key]);

  const clearDraft = useCallback(() => { safeRemove(key); setWasRestored(false); }, [key]);
  const dismissRestoredNotice = useCallback(() => setWasRestored(false), []);

  return { value, setValue, clearDraft, wasRestored, dismissRestoredNotice };
}
