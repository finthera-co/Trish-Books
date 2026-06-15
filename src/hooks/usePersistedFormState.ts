import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Draft persistence for forms so a browser refresh doesn't lose half-entered
 * data.
 *
 * Stores to sessionStorage (clears when the tab closes). Returns the same API
 * shape as useState, plus a clear() to wipe the draft on submit/cancel.
 *
 * Scope the key per-record (e.g. include editAccount?.id) so the edit form for
 * account A never rehydrates into account B.
 *
 * Note: the stored value is read once, when the hook first mounts with
 * `enabled` true. Mount the form (or gate `enabled`) so it is enabled at the
 * moment you want rehydration to happen — typically when the dialog is open.
 */
export function usePersistedFormState<T>(
  key: string,
  initial: T,
  opts: { enabled?: boolean } = {}
) {
  const { enabled = true } = opts;
  const storageKey = `finthera:form-draft:${key}`;

  const [state, setState] = useState<T>(() => {
    if (!enabled || typeof window === "undefined") return initial;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      /* ignore parse / privacy-mode errors */
    }
    return initial;
  });

  // Persist on every change. Skip the first run so we don't immediately
  // re-write the value we just rehydrated.
  const skipFirst = useRef(true);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* ignore quota / privacy mode */
    }
  }, [state, storageKey, enabled]);

  const clear = useCallback(() => {
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  return { state, setState, clear } as const;
}
