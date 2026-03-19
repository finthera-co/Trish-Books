import { useCallback, useEffect, useRef, useState } from "react";

const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const COUNTDOWN_SECONDS = 60;

interface IdleTimerState {
  isIdle: boolean;
  countdown: number;
  resetIdle: () => void;
}

/** Tracks whether active API calls or form submissions are in progress */
let activeOperations = 0;

export function markOperationStart() {
  activeOperations++;
}

export function markOperationEnd() {
  activeOperations = Math.max(0, activeOperations - 1);
}

export function useIdleTimer(enabled: boolean): IdleTimerState {
  const [isIdle, setIsIdle] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  const startIdleTimer = useCallback(() => {
    if (!enabled) return;
    clearTimers();
    idleTimerRef.current = setTimeout(() => {
      // Don't trigger idle if operations are in progress
      if (activeOperations > 0) {
        startIdleTimer();
        return;
      }
      setIsIdle(true);
      setCountdown(COUNTDOWN_SECONDS);
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, IDLE_TIMEOUT);
  }, [enabled, clearTimers]);

  const resetIdle = useCallback(() => {
    setIsIdle(false);
    setCountdown(COUNTDOWN_SECONDS);
    startIdleTimer();
  }, [startIdleTimer]);

  useEffect(() => {
    if (!enabled || isIdle) return;

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    const handleActivity = () => {
      startIdleTimer();
    };

    events.forEach((e) => window.addEventListener(e, handleActivity, { passive: true }));
    startIdleTimer();

    return () => {
      events.forEach((e) => window.removeEventListener(e, handleActivity));
      clearTimers();
    };
  }, [enabled, isIdle, startIdleTimer, clearTimers]);

  return { isIdle, countdown, resetIdle };
}
