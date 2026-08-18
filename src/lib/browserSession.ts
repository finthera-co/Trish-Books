import { clearAllFintheraDrafts } from "@/hooks/useDraftPersistence";

/**
 * Ends the login when the *browser* is closed, without breaking multi-tab use.
 *
 * The Supabase session lives in localStorage so every tab shares one login, but
 * localStorage outlives the browser process — a closed-and-reopened browser
 * would still be signed in. This guard scopes that stored session to the life
 * of the browser session instead. On boot a tab keeps the stored session only
 * if it can show one of two things:
 *
 *  1. A sibling tab is still running. Every tab counts itself in
 *     `finthera:open-tabs` (incremented on load, decremented on pagehide, which
 *     fires for each tab when the browser quits), and keeps a heartbeat so a
 *     crash that skips the decrement cannot leave the counter stuck above zero
 *     forever. The heartbeat window is deliberately generous: browsers throttle
 *     and eventually freeze timers in background tabs, and treating one of
 *     those as dead would sign out a session that is genuinely still open.
 *
 *  2. The last tab closed a moment ago — that is a reload or a full-page
 *     navigation, not a new browser session.
 *
 * Note that a per-tab sessionStorage marker would be the obvious way to spot a
 * reload, but Chrome's "continue where you left off" restores sessionStorage
 * after a restart, so such a marker cannot tell a reload from a relaunch. The
 * close-to-open gap in (2) can.
 *
 * Must run before `createClient`, since it decides what the auth client finds
 * in storage on boot.
 */

const OPEN_TABS_KEY = "finthera:open-tabs";
const HEARTBEAT_KEY = "finthera:session-heartbeat";
const CLOSED_AT_KEY = "finthera:last-tab-closed-at";
const ACTIVITY_KEY = "finthera:last-activity";
const SIGN_OUT_REASON_KEY = "finthera:signed-out-reason";

const HEARTBEAT_INTERVAL_MS = 30_000;
/** Only ever reached after a crash or force-quit — see (1) above. */
const HEARTBEAT_STALE_MS = 10 * 60 * 1000;
/** How long a reload is allowed to take before it looks like a fresh launch. */
const RELOAD_GRACE_MS = 10_000;

/* Storage throws outright in some private-browsing modes, so every access is
 * guarded. Failing open there is the safe default: the worst case is that the
 * guard does nothing, and such a browser discards everything on close anyway. */
function store(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function readNumber(key: string): number | null {
  const raw = store()?.getItem(key);
  if (raw == null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function write(key: string, value: number) {
  try { store()?.setItem(key, String(value)); } catch { /* quota / unavailable */ }
}

function readTabCount(): number {
  return Math.max(0, readNumber(OPEN_TABS_KEY) ?? 0);
}

function bumpTabCount(delta: number) {
  write(OPEN_TABS_KEY, Math.max(0, readTabCount() + delta));
}

function beat() {
  write(HEARTBEAT_KEY, Date.now());
}

function ageOf(key: string): number {
  const at = readNumber(key);
  return at == null ? Number.POSITIVE_INFINITY : Date.now() - at;
}

/** True when the stored session still belongs to the current browser session. */
function sessionIsStillOurs(): boolean {
  const siblingIsOpen = readTabCount() > 0 && ageOf(HEARTBEAT_KEY) < HEARTBEAT_STALE_MS;
  const justReloaded = ageOf(CLOSED_AT_KEY) < RELOAD_GRACE_MS;
  return siblingIsOpen || justReloaded;
}

export type SignOutReason = "idle";

/* Kept per-tab and read once, so the notice appears on the tab that was signed
 * out and does not resurface on the next visit. */
export function setSignOutReason(reason: SignOutReason) {
  try { window.sessionStorage.setItem(SIGN_OUT_REASON_KEY, reason); } catch { /* ignore */ }
}

export function takeSignOutReason(): SignOutReason | null {
  try {
    const reason = window.sessionStorage.getItem(SIGN_OUT_REASON_KEY);
    if (reason) window.sessionStorage.removeItem(SIGN_OUT_REASON_KEY);
    return reason as SignOutReason | null;
  } catch { return null; }
}

/** Marks the user as active. Shared across tabs, so work in any tab counts. */
export function recordActivity() {
  write(ACTIVITY_KEY, Date.now());
}

/** Milliseconds since the user last did anything in any tab. */
export function idleFor(): number {
  return ageOf(ACTIVITY_KEY);
}

/**
 * Drops the persisted Supabase session (and the drafts tied to that login) so
 * the auth client boots signed out. Sticky drafts are deliberately kept: closing
 * the browser mid-entry must not destroy work the user cannot retype.
 */
function purgeStoredSession() {
  const local = store();
  if (!local) return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < local.length; i++) {
      const key = local.key(i);
      // `sb-<project-ref>-auth-token`, its chunked `...-auth-token.0` variants,
      // and the pre-v2 key.
      if (key && (/^sb-.+-auth-token(\.\d+)?$/.test(key) || key === "supabase.auth.token")) {
        toRemove.push(key);
      }
    }
    toRemove.forEach((key) => local.removeItem(key));
  } catch { /* ignore */ }
  clearAllFintheraDrafts();
}

let started = false;

/** Returns a teardown for tests; the app calls this once and never unwinds it. */
export function initBrowserSessionGuard(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;

  if (sessionIsStillOurs()) {
    bumpTabCount(1);
  } else {
    purgeStoredSession();
    // Reset rather than increment: a counter that drifted upwards (a tab whose
    // pagehide never fired) is exactly how we got here, so start clean.
    write(OPEN_TABS_KEY, 1);
  }
  beat();
  recordActivity();

  const timer = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);

  // pagehide fires for every tab when the browser is quit, and unlike
  // beforeunload it is reliable on mobile Safari.
  const onPageHide = (event: PageTransitionEvent) => {
    bumpTabCount(-1);
    if (event.persisted) return; // bfcache: pageshow re-registers this tab
    window.clearInterval(timer);
    write(CLOSED_AT_KEY, Date.now());
  };

  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    bumpTabCount(1);
    beat();
  };

  // A tab returning to the foreground is proof of life even if its heartbeat
  // timer was throttled to a standstill while hidden.
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") beat();
  };

  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    window.clearInterval(timer);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    started = false;
  };
}
