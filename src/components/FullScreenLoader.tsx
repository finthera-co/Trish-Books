import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import BrandMark from "@/components/BrandMark";

const LOADING_MESSAGES = [
  "Loading your accounts…",
  "Fetching invoices & bills…",
  "Syncing vendor data…",
  "Preparing your workspace…",
];

/** Full-screen blocking loader shown during login/tenant-switch hydration. */
export default function FullScreenLoader() {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-5 text-center px-6">
        <BrandMark className="h-16 w-16 rounded-xl" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground min-h-[1.5rem] transition-opacity duration-300">
          {LOADING_MESSAGES[messageIndex]}
        </p>
      </div>
    </div>
  );
}
