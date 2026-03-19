import { useCallback, useEffect, useRef, useState } from "react";

interface NetworkState {
  isOffline: boolean;
  isSlow: boolean;
}

const SLOW_THRESHOLD = 5000; // 5 seconds

export function useNetworkStatus(): NetworkState {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isSlow, setIsSlow] = useState(false);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRequests = useRef(0);

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

  // Monitor fetch for slow responses
  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async (...args) => {
      pendingRequests.current++;
      const timer = setTimeout(() => {
        if (pendingRequests.current > 0 && navigator.onLine) {
          setIsSlow(true);
        }
      }, SLOW_THRESHOLD);

      try {
        const response = await originalFetch(...args);
        clearTimeout(timer);
        pendingRequests.current = Math.max(0, pendingRequests.current - 1);
        if (pendingRequests.current === 0) setIsSlow(false);
        return response;
      } catch (error) {
        clearTimeout(timer);
        pendingRequests.current = Math.max(0, pendingRequests.current - 1);
        if (pendingRequests.current === 0) setIsSlow(false);
        throw error;
      }
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return { isOffline, isSlow };
}
