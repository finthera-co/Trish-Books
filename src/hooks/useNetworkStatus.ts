import { useEffect, useState } from "react";

interface NetworkState {
  isOffline: boolean;
  isSlow: boolean;
}

/**
 * Network status detector.
 *
 * SLOW_THRESHOLD_MS is 12s, not 5s: Supabase runs in ap-northeast-2 (Seoul),
 * and the login hydration burst fires ~12 parallel prefetch queries. Any one
 * of them legitimately taking 8-10s on a warm Sri Lankan mobile connection
 * doesn't mean the connection is slow in a user-perceivable sense — the
 * burst still finishes in parallel.
 *
 * MIN_SLOW_CONCURRENT gates the banner on 3+ requests being stuck past the
 * threshold AT THE SAME TIME, so one large query (e.g. a 100-row fetch)
 * doesn't trip it on its own.
 *
 * The fetch patch is applied once at module scope (not per-mount) so HMR
 * and repeated mounts of this hook never stack multiple wrappers around
 * window.fetch.
 */
const SLOW_THRESHOLD_MS = 12_000;
const MIN_SLOW_CONCURRENT = 3;

let patchApplied = false;
let slowPending = 0;
let slowCallback: ((isSlow: boolean) => void) | null = null;

function patchFetch() {
  if (patchApplied) return;
  patchApplied = true;
  const originalFetch = window.fetch;

  window.fetch = async (...args: Parameters<typeof fetch>) => {
    let firedSlow = false;
    const timer = setTimeout(() => {
      firedSlow = true;
      slowPending++;
      if (slowPending >= MIN_SLOW_CONCURRENT && navigator.onLine) {
        slowCallback?.(true);
      }
    }, SLOW_THRESHOLD_MS);

    try {
      return await originalFetch(...args);
    } finally {
      clearTimeout(timer);
      // Only a request whose timer actually fired contributed to slowPending —
      // decrementing unconditionally here would let fast requests wrongly
      // cancel a still-genuine slow-connection state.
      if (firedSlow) {
        slowPending = Math.max(0, slowPending - 1);
        if (slowPending < MIN_SLOW_CONCURRENT) {
          slowCallback?.(false);
        }
      }
    }
  };
}

export function useNetworkStatus(): NetworkState {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => {
      setIsOffline(false);
      setIsSlow(false);
    };

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);

    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  useEffect(() => {
    slowCallback = setIsSlow;
    patchFetch();

    return () => {
      slowCallback = null;
    };
  }, []);

  return { isOffline, isSlow };
}
