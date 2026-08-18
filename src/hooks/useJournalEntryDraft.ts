import { useCallback, useEffect, useRef, useState } from "react";
import { STICKY_DRAFT_PREFIX } from "@/hooks/useDraftPersistence";

const DRAFT_VERSION = "v1"; // bump to invalidate every stored journal draft after a shape change
const WRITE_DEBOUNCE_MS = 500;

/**
 * The part of a journal entry form that is worth keeping when a post fails.
 * Generic over the line shape: the create dialog and the edit page carry
 * different per-line dimensions, and both are stored verbatim.
 */
export interface JournalDraftValue<L> {
  entryDate: string;
  reference: string;
  chequeNumber: string;
  lines: L[];
}

interface StoredDraft<L> extends JournalDraftValue<L> {
  savedAt: number;
}

function keyFor(entry: string, scope: string) {
  return `${STICKY_DRAFT_PREFIX}:${DRAFT_VERSION}:journal-entry:${entry}:${scope}`;
}

function read<L>(key: string): StoredDraft<L> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<L>;
    // A draft without lines restores nothing; treat it as absent.
    return Array.isArray(parsed?.lines) ? parsed : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / privacy mode */ }
}
function remove(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/** Field-by-field compare, so an untouched form is never stored as a draft. */
function same<L>(a: JournalDraftValue<L>, b: JournalDraftValue<L>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Keeps a journal entry form recoverable.
 *
 * Every keystroke is mirrored to local storage, so a post that never lands —
 * dropped connection, expired token, closed tab, crashed browser — leaves the
 * work exactly where it was. The draft is deleted only when the entry actually
 * posts, or when the user discards it; a failed save keeps it.
 *
 * The draft is *sticky* (see STICKY_DRAFT_PREFIX): an idle timeout or a closed
 * browser will not take it with them, so the user finds their entry again after
 * signing back in. It is keyed per tenant+user, and an explicit sign-out clears
 * it.
 */
export function useJournalEntryDraft<L>(opts: {
  /** "new" for the create form, the entry id when editing an existing one. */
  entry: string | null;
  /** tenant+user — one person's draft must never rehydrate for another. */
  scope: string | null;
  /** The form as it stands right now. */
  value: JournalDraftValue<L>;
  /** What an untouched form looks like; a value equal to it is not stored. */
  baseline: JournalDraftValue<L> | null;
  /**
   * Whether the form holds anything a user would mind losing. Kept separate
   * from `baseline` because a form can differ from its baseline without holding
   * real work — the create dialog auto-fills the next JV reference the moment it
   * opens, and that alone is not a draft.
   */
  hasContent: boolean;
  /** False while the form is not live yet (dialog closed, entry still loading). */
  ready: boolean;
  /** Applies a recovered draft to the form. Called at most once per key. */
  onRestore: (draft: JournalDraftValue<L>) => void;
}) {
  const { entry, scope, value, baseline, hasContent, ready, onRestore } = opts;
  const key = entry && scope ? keyFor(entry, scope) : null;

  // When a draft was recovered — drives the "unsaved entry restored" notice.
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  // Set once the draft has been read, so an empty form can never overwrite a
  // stored draft in the window before it is applied.
  const [hydrated, setHydrated] = useState(false);

  const latest = useRef({ value, baseline, hasContent });
  latest.current = { value, baseline, hasContent };
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;

  // Read (and apply) the stored draft once per key, the moment the form is live.
  const hydratedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) {
      // The form went back to sleep (dialog closed). Allow a fresh read next
      // time it opens, so a draft written in another tab is picked up.
      hydratedKey.current = null;
      setHydrated(false);
      return;
    }
    if (!key || hydratedKey.current === key) return;
    hydratedKey.current = key;

    const stored = read<L>(key);
    const base = latest.current.baseline;
    if (stored && !(base && same(stored, base))) {
      const { savedAt, ...draft } = stored;
      restoreRef.current(draft as JournalDraftValue<L>);
      setRestoredAt(savedAt ?? Date.now());
    } else {
      setRestoredAt(null);
    }
    setHydrated(true);
  }, [key, ready]);

  const persist = useCallback(() => {
    if (!key || !ready || !hydrated) return;
    const { value: v, baseline: base, hasContent: filled } = latest.current;
    // An untouched form is not a draft. Nothing is deleted here either — the
    // user emptying the form should not silently destroy what was stored.
    if (!filled) return;
    if (base && same(v, base)) return;
    write(key, { ...v, savedAt: Date.now() } satisfies StoredDraft<L>);
  }, [key, ready, hydrated]);

  // Debounced write on every change.
  useEffect(() => {
    if (!key || !ready || !hydrated) return;
    const t = setTimeout(persist, WRITE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [key, ready, hydrated, persist, value]);

  // Refresh, tab close and browser quit skip the debounce, so the last
  // keystroke is never the one that is lost.
  useEffect(() => {
    if (!key || !ready || !hydrated) return;
    const flush = () => persist();
    const onHidden = () => { if (document.visibilityState === "hidden") persist(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
      // Unmounting mid-edit (a navigation away, a session redirect) is exactly
      // the case this exists for.
      persist();
    };
  }, [key, ready, hydrated, persist]);

  /** Delete the draft — call once the entry has actually posted. */
  const clearDraft = useCallback(() => {
    if (key) remove(key);
    setRestoredAt(null);
  }, [key]);

  /** Hide the restored notice without touching the stored draft. */
  const dismissRestoredNotice = useCallback(() => setRestoredAt(null), []);

  return { restoredAt, clearDraft, dismissRestoredNotice, saveDraftNow: persist };
}
