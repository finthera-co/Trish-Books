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
  const isIdleRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    idleTimerRef.current = null;
    countdownRef.current = null;
  }, []);

  const startIdleTimer = useCallback(() => {
    if (!enabled) return;

    if (isIdleRef.current) {
      setIsIdle(false);
      isIdleRef.current = false;
    }

    setCountdown(COUNTDOWN_SECONDS);
    clearTimers();

    idleTimerRef.current = setTimeout(() => {
      if (activeOperations > 0) {
        startIdleTimer();
        return;
      }

      setIsIdle(true);
      isIdleRef.current = true;
      setCountdown(COUNTDOWN_SECONDS);

      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            countdownRef.current = null;
            return 0;
          }

          return prev - 1;
        });
      }, 1000);
    }, IDLE_TIMEOUT);
  }, [enabled, clearTimers]);

  const resetIdle = useCallback(() => {
    startIdleTimer();
  }, [startIdleTimer]);

  useEffect(() => {
    isIdleRef.current = isIdle;
  }, [isIdle]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      setIsIdle(false);
      isIdleRef.current = false;
      setCountdown(COUNTDOWN_SECONDS);
      return;
    }

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    const handleActivity = () => {
      startIdleTimer();
    };

    events.forEach((eventName) => window.addEventListener(eventName, handleActivity, { passive: true }));
    startIdleTimer();

    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, handleActivity));
      clearTimers();
    };
  }, [enabled, startIdleTimer, clearTimers]);

  return { isIdle, countdown, resetIdle };
}
