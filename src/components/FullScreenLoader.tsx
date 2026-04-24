import { Loader2 } from "lucide-react";

/** Full-screen blocking loader — spinner only, no text. */
export default function FullScreenLoader() {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}
