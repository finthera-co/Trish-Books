import { useEffect } from "react";
import { idleFor, recordActivity } from "@/lib/browserSession";

/** How long the app may sit untouched before the session is ended. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Activity is written to shared storage at most this often. */
const RECORD_THROTTLE_MS = 5_000;
const CHECK_INTERVAL_MS = 15_000;

/* Deliberately coarse: real interaction only. Pointer movement alone is not
 * treated as activity, so a mouse resting on a trackpad cannot hold a session
 * open on an unattended machine. */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "submit"] as const;

/**
 * Signs the user out after a period of inactivity, and records why so the login
 * screen can explain the redirect. Activity in any tab keeps every tab alive,
 * matching the shared login, and the check is timestamp-based so time spent
 * with the laptop asleep still counts against the timeout.
 */
export function useIdleLogout(enabled: boolean, onIdle: () => void) {
  useEffect(() => {
    if (!enabled) return;

    recordActivity();

    let lastRecorded = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastRecorded < RECORD_THROTTLE_MS) return;
      lastRecorded = now;
      recordActivity();
    };

    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, onActivity, { passive: true, capture: true }),
    );

    let done = false;
    const check = () => {
      if (done || idleFor() < IDLE_TIMEOUT_MS) return;
      done = true;
      onIdle();
    };

    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    // A throttled background tab may not tick for minutes; catch up the moment
    // it is looked at again.
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      ACTIVITY_EVENTS.forEach((event) =>
        window.removeEventListener(event, onActivity, { capture: true }),
      );
    };
  }, [enabled, onIdle]);
}
